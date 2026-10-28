/*!
 * スタンレー イージーオーダー：サイズ入力 → 価格区分 自動選択スクリプト（futureshop 商品ページ用）
 *
 * 仕組み
 *   ・「仕上がり幅」「仕上がり丈」(テキスト入力オプション) から料金区分を判定し、
 *     非表示の「サイズ区分」(価格付きプルダウンオプション) を自動で選択する。
 *   ・巾100cm以下は「両開き」を選べないようにする。
 *   ・入力が不正な間は「カートに入れる」を止める。
 *   ・オプションは「項目名」で探すので、管理画面での登録順（番号）が変わっても動く。
 */
(function () {
  'use strict';

  // ===== 設定（管理画面の登録内容と合わせる） =====
  var CONFIG = {
    label: {
      size: 'サイズ区分',   // 価格付きプルダウン（非表示にする）
      width: '仕上がり幅',  // テキスト入力
      height: '仕上がり丈', // テキスト入力
      open: '開き方'        // ラジオ（片開き / 両開き）
    },
    openBoth: '両開き',      // 「両開き」の選択肢名に含まれる文字
    openSingle: '片開き',
    width: { min: 50, max: 300 },  // ※最小値は仕入先に要確認
    height: { min: 50, max: 240 }, // 丈50cm未満は形状記憶加工不可のため50から
    bothMinWidth: 101,             // 両開きにできる最小の幅
    basePrice: 7040,               // 商品の販売価格（税込）＝最安区分
    // 料金表（税込）。name はプルダウンの選択肢名の先頭と一致させる
    bands: [
      { w: 100, h: 140, price: 7040, name: '巾100cmまで×丈140cmまで' },
      { w: 100, h: 240, price: 8140, name: '巾100cmまで×丈240cmまで' },
      { w: 200, h: 140, price: 14080, name: '巾200cmまで×丈140cmまで' },
      { w: 200, h: 240, price: 16280, name: '巾200cmまで×丈240cmまで' },
      { w: 300, h: 140, price: 21120, name: '巾300cmまで×丈140cmまで' },
      { w: 300, h: 240, price: 24420, name: '巾300cmまで×丈240cmまで' }
    ],
    cartButton: '.fs-c-button--addToCart--detail, .fs-c-button--addToCart--variation',
    // カラー画像：選択肢の1番目に登録画像の start 番、2番目に start+1 番…を使う
    color: {
      label: 'カラー',
      start: 21,
      width: 200,                                   // 取得する画像の幅(px)
      host: 'https://manabeih.itembox.cloud'        // ページから画像URLが拾えない場合の予備
    }
  };

  // ===== DOM ヘルパー =====
  function text(el) {
    return (el && el.textContent || '').replace(/\s+/g, '');
  }

  // 項目名（必須マーク「*」「(必須)」を除く）
  function optionName(el) {
    var c = el.cloneNode(true);
    var marks = c.querySelectorAll('.fs-c-requiredMark');
    for (var i = 0; i < marks.length; i++) marks[i].parentNode.removeChild(marks[i]);
    return text(c).replace(/\(必須\)|（必須）|[*＊※]/g, '');
  }

  // 項目名から <dt> と <dd> を探す
  function findOption(label) {
    var names = document.querySelectorAll('.fs-c-productOption__name');
    for (var i = 0; i < names.length; i++) {
      if (optionName(names[i]) !== label) continue;
      var dd = names[i].nextElementSibling;
      while (dd && !dd.classList.contains('fs-c-productOption__option')) dd = dd.nextElementSibling;
      if (!dd) {
        var wrap = names[i].closest('.fs-c-productOption');
        dd = wrap && wrap.querySelector('.fs-c-productOption__option');
      }
      if (dd) return { dt: names[i], dd: dd };
    }
    return null;
  }

  function fire(el, type) {
    var ev;
    try { ev = new Event(type, { bubbles: true }); } catch (e) {
      ev = document.createEvent('HTMLEvents'); ev.initEvent(type, true, false);
    }
    el.dispatchEvent(ev);
    if (window.jQuery) window.jQuery(el).trigger(type);
  }

  // 全角数字・全角ピリオドを半角に
  function toNumber(v) {
    var s = String(v || '').trim()
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[．。]/g, '.')
      .replace(/cm$/i, '');
    if (!/^\d+(\.\d)?$/.test(s)) return NaN;
    return parseFloat(s);
  }

  function yen(n) {
    return '¥' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // オプション欄の「+¥0(税込)」表示を消す（0円以外の加算表示は残す）
  var ZERO_PRICE = /[(（]?\s*[+＋]\s*[¥￥]\s*0(?![\d,.])\s*(?:[(（]\s*税込\s*[)）]|税込)?\s*[)）]?/g;
  var ZERO_ONLY = /^[(（]?[+＋][¥￥]0(?:[(（]税込[)）]|税込)?[)）]?$/;
  var TAX_ONLY = /^[(（]税込[)）]$/;
  function hideZeroPrices() {
    var areas = document.querySelectorAll('.fs-c-productOption__option');
    for (var a = 0; a < areas.length; a++) {
      // 1) 「+¥0(税込)」だけを含む要素は丸ごと非表示
      var els = areas[a].querySelectorAll('*');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (/^(INPUT|SELECT|OPTION|TEXTAREA)$/.test(el.tagName)) continue;
        // 入力欄などを含む枠は消さない（入力欄は文字を持たないため「+¥0(税込)」だけの枠に見える）
        if (el.querySelector('input, select, textarea, button')) continue;
        var t = text(el);
        var prevEl = el.previousElementSibling;
        if (ZERO_ONLY.test(t) || (TAX_ONLY.test(t) && prevEl && prevEl.hasAttribute('data-so-zero'))) {
          el.style.display = 'none';
          el.setAttribute('data-so-zero', '');
        }
      }
      // 2) 他の文字と同じテキストに混ざっている場合は、その部分だけ削除
      var walker = document.createTreeWalker(areas[a], NodeFilter.SHOW_TEXT, null, false);
      var nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (var n = 0; n < nodes.length; n++) {
        var node = nodes[n];
        if (node.parentNode.closest && node.parentNode.closest('[data-so-zero], .so-result, .so-cart-hint')) continue;
        if (ZERO_PRICE.test(node.nodeValue)) {
          node.nodeValue = node.nodeValue.replace(ZERO_PRICE, '');
        }
        ZERO_PRICE.lastIndex = 0;
        // 3) 「+¥0」を消した直後に残った「(税込)」も消す
        var prev = node.previousSibling;
        if (TAX_ONLY.test(node.nodeValue.replace(/\s+/g, '')) && prev && prev.nodeType === 1 && prev.hasAttribute('data-so-zero')) {
          node.nodeValue = '';
        }
      }
    }
  }

  // 項目名の後ろ（必須マーク「*」の前）に単位を付ける：仕上がり幅* → 仕上がり幅（cm）*
  function addUnit(opt, unit) {
    var labelEl = opt.dt.querySelector('.fs-c-productOption__label') || opt.dt;
    var span = document.createElement('span');
    span.className = 'so-unit';
    span.textContent = unit;
    var mark = labelEl.querySelector('.fs-c-requiredMark');
    if (mark) { mark.parentNode.insertBefore(span, mark); return; }
    var walker = document.createTreeWalker(labelEl, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      var node = walker.currentNode;
      var idx = node.nodeValue.search(/[*＊]|\(必須\)|（必須）/);
      if (idx !== -1) {
        var rest = node.splitText(idx);
        rest.parentNode.insertBefore(span, rest);
        return;
      }
    }
    labelEl.appendChild(span);
  }

  // ===== カラー画像 =====
  // 画面に見えている文字だけ（非表示にした「+¥0(税込)」を含めない）
  function visibleText(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // 商品画像URL（…/product/145/000000014519/000000014519-01.jpg）の「-」までを求める
  function productImageBase() {
    var re = /(https?:\/\/[^"'\s?]+\/product\/\d+\/(\d+)\/\2-)\d+\.(?:jpe?g|png|gif|webp)/i;
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var srcs = [imgs[i].getAttribute('src'), imgs[i].getAttribute('data-src'), imgs[i].getAttribute('data-lazy')];
      for (var j = 0; j < srcs.length; j++) {
        var m = srcs[j] && srcs[j].match(re);
        if (m) return m[1];
      }
    }
    // ページに商品画像がない場合は商品IDから組み立てる（14519 → /product/145/000000014519/000000014519-）
    var idEl = document.querySelector('input[name="productId"]') || document.querySelector('[data-product-id]');
    var id = idEl && (idEl.value || idEl.getAttribute('data-product-id'));
    if (!id || !/^\d+$/.test(id)) return null;
    var padded = ('000000000000' + id).slice(-12);
    var dir = ('000' + Math.floor(Number(id) / 100)).slice(-3);
    return CONFIG.color.host + '/product/' + dir + '/' + padded + '/' + padded + '-';
  }

  function setupColorSwatches() {
    var opt = findOption(CONFIG.color.label);
    if (!opt) return;
    var radios = opt.dd.querySelectorAll('input[type="radio"]');
    var base = productImageBase();
    if (!radios.length || !base) return;

    opt.dd.classList.add('so-swatches');
    var current = document.createElement('span');
    current.className = 'so-swatch-current';
    var labelEl = opt.dt.querySelector('.fs-c-productOption__label') || opt.dt;
    labelEl.appendChild(current);

    function refresh() {
      current.textContent = '';
      for (var i = 0; i < radios.length; i++) {
        var item = radios[i].closest('.fs-c-radio') || radios[i].parentNode;
        item.classList.toggle('is-selected', radios[i].checked);
        if (radios[i].checked) {
          var lb = document.querySelector('label[for="' + radios[i].id + '"]');
          current.textContent = '：' + (lb ? visibleText(lb) : radios[i].value);
        }
      }
    }

    for (var i = 0; i < radios.length; i++) {
      var lb = radios[i].id && document.querySelector('label[for="' + radios[i].id + '"]');
      var target = lb || radios[i].parentNode;
      var item = radios[i].closest('.fs-c-radio') || radios[i].parentNode;
      item.classList.add('so-swatch-item');
      // 並べる枠はテーマによって違うので、色の部品の親に直接クラスを付ける
      if (item.parentNode) item.parentNode.classList.add('so-swatch-wrap');
      var no = ('0' + (CONFIG.color.start + i)).slice(-2);
      var tip = document.createElement('span');
      tip.className = 'so-swatch';
      var img = document.createElement('img');
      img.alt = visibleText(target);
      img.loading = 'lazy';
      img.src = base + no + '.jpg?w=' + btoa(String(CONFIG.color.width));
      // 画像が未登録なら丸を出さず文字だけにする
      img.onerror = function () { this.parentNode.parentNode.removeChild(this.parentNode); };
      tip.appendChild(img);
      target.insertBefore(tip, target.firstChild);
      radios[i].addEventListener('change', refresh);
    }
    refresh();
  }

  function findBand(w, h) {
    for (var i = 0; i < CONFIG.bands.length; i++) {
      var b = CONFIG.bands[i];
      if (w <= b.w && h <= b.h) return b;
    }
    return null;
  }

  // ===== 初期化 =====
  function init() {
    var size = findOption(CONFIG.label.size);
    var width = findOption(CONFIG.label.width);
    var height = findOption(CONFIG.label.height);
    var open = findOption(CONFIG.label.open);
    if (!size && !width && !height) return; // オーダー商品以外のページでは何もしない
    if (!size || !width || !height) {
      if (window.console) console.warn('[stanley-order] 項目が見つかりません：' +
        [!size && CONFIG.label.size, !width && CONFIG.label.width, !height && CONFIG.label.height].filter(Boolean).join('、'));
      return;
    }

    var sizeSelect = size.dd.querySelector('select');
    var wInput = width.dd.querySelector('input[type="text"], input[type="number"]');
    var hInput = height.dd.querySelector('input[type="text"], input[type="number"]');
    var openRadios = open ? open.dd.querySelectorAll('input[type="radio"]') : [];
    if (!sizeSelect || !wInput || !hInput) return;

    hideZeroPrices();
    window.addEventListener('load', hideZeroPrices);
    setupColorSwatches();

    // サイズ区分の行は非表示（値は送信される）
    size.dt.style.display = 'none';
    size.dd.style.display = 'none';

    addUnit(width, '（cm）');
    addUnit(height, '（cm）');

    wInput.setAttribute('inputmode', 'decimal');
    hInput.setAttribute('inputmode', 'decimal');
    // 数字入力欄の高さを今の1.5倍に
    [wInput, hInput].forEach(function (inp) {
      var hgt = inp.offsetHeight || 36;
      inp.style.boxSizing = 'border-box';
      inp.style.height = Math.round(hgt * 1.5) + 'px';
      inp.style.fontSize = '18px';
    });
    wInput.setAttribute('placeholder', CONFIG.width.min + '〜' + CONFIG.width.max);
    hInput.setAttribute('placeholder', CONFIG.height.min + '〜' + CONFIG.height.max);

    // 価格表示ボックス
    var box = document.createElement('div');
    box.className = 'so-result';
    box.innerHTML =
      '<div class="so-result__price"></div>' +
      '<div class="so-result__msg" role="alert"></div>';
    // 価格表示は、すべての入力項目の最後（表示されている最後のオプション欄の末尾）に置く
    var dds = document.querySelectorAll('.fs-c-productOption__option');
    var lastDd = height.dd;
    for (var k = dds.length - 1; k >= 0; k--) {
      if (dds[k] !== size.dd && dds[k].offsetParent !== null) { lastDd = dds[k]; break; }
    }
    lastDd.appendChild(box);
    var priceEl = box.querySelector('.so-result__price');
    var msgEl = box.querySelector('.so-result__msg');

    var state = { ok: false, message: '仕上がり幅・仕上がり丈を入力してください。' };

    function radioLabel(r) {
      var lb = r.id && document.querySelector('label[for="' + r.id + '"]');
      return text(lb || r.parentNode);
    }

    function updateOpen(w) {
      var allowBoth = !(w > 0) || w >= CONFIG.bothMinWidth;
      for (var i = 0; i < openRadios.length; i++) {
        var r = openRadios[i];
        if (radioLabel(r).indexOf(CONFIG.openBoth) === -1) continue;
        r.disabled = !allowBoth;
        if (!allowBoth && r.checked) {
          r.checked = false;
          for (var j = 0; j < openRadios.length; j++) {
            if (radioLabel(openRadios[j]).indexOf(CONFIG.openSingle) !== -1) {
              openRadios[j].checked = true; fire(openRadios[j], 'change');
            }
          }
        }
      }
      return allowBoth;
    }

    function isBothChecked() {
      for (var i = 0; i < openRadios.length; i++) {
        if (openRadios[i].checked && radioLabel(openRadios[i]).indexOf(CONFIG.openBoth) !== -1) return true;
      }
      return false;
    }

    function selectBand(band) {
      for (var i = 0; i < sizeSelect.options.length; i++) {
        var o = sizeSelect.options[i];
        if (text(o).indexOf(band.name.replace(/\s+/g, '')) === 0) {
          if (sizeSelect.selectedIndex !== i) {
            sizeSelect.selectedIndex = i;
            fire(sizeSelect, 'change');
          }
          return true;
        }
      }
      return false;
    }

    function update() {
      var w = toNumber(wInput.value);
      var h = toNumber(hInput.value);
      var allowBoth = updateOpen(w);
      var msgs = [];

      if (wInput.value === '' || hInput.value === '') {
        msgs.push('仕上がり幅・仕上がり丈を入力してください。');
      }
      if (wInput.value !== '' && isNaN(w)) msgs.push('仕上がり幅は数字で入力してください（小数点以下1桁まで）。');
      if (hInput.value !== '' && isNaN(h)) msgs.push('仕上がり丈は数字で入力してください（小数点以下1桁まで）。');
      if (w < CONFIG.width.min || w > CONFIG.width.max) {
        msgs.push('仕上がり幅は' + CONFIG.width.min + '〜' + CONFIG.width.max + 'cmで入力してください。');
      }
      if (h < CONFIG.height.min || h > CONFIG.height.max) {
        msgs.push('仕上がり丈は' + CONFIG.height.min + '〜' + CONFIG.height.max + 'cmで入力してください。');
      }
      // 両開きは2等分するため、幅は偶数のみ
      var both = isBothChecked();
      if (both && w > 0 && w % 2 !== 0) {
        msgs.push('両開きの場合、仕上がり幅は偶数（例：150cm）で入力してください。');
      }

      var band = msgs.length ? null : findBand(w, h);
      if (band && !selectBand(band)) {
        msgs.push('価格区分の設定エラーです。お手数ですがお問い合わせください。');
        band = null;
      }
      // 不正な間は先頭の「サイズ未確定」に戻す
      if (!band && sizeSelect.selectedIndex !== 0) {
        sizeSelect.selectedIndex = 0;
        fire(sizeSelect, 'change');
      }

      state.ok = !!band;
      state.message = msgs.join('\n');
      priceEl.innerHTML = band ? '価格 <strong>' + yen(band.price) + '</strong>（税込・1窓分）' : '';
      msgEl.textContent = msgs.length ? msgs[0] : '';
      if (band && !allowBoth) msgEl.textContent = '※巾100cm以下は片開きのみです。';
      box.classList.toggle('is-error', !band && (wInput.value !== '' || hInput.value !== ''));
      setCartEnabled(state.ok, msgs[0]);
    }

    // カートボタン（futureshopのクラス名、なければ「カートに入れる」の文言で探す）
    function cartButtons() {
      var list = [].slice.call(document.querySelectorAll(CONFIG.cartButton));
      if (list.length) return list;
      var all = document.querySelectorAll('button, a, input[type="submit"], input[type="button"]');
      for (var i = 0; i < all.length; i++) {
        if (/カートに(入れる|追加)/.test(text(all[i]) || all[i].value || '')) list.push(all[i]);
      }
      return list;
    }

    // 入力が正しくなるまでカートボタンを押せなくする
    function setCartEnabled(ok, message) {
      var btns = cartButtons();
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (!ok) {
          if (!b.disabled || b.hasAttribute('data-so-disabled')) {
            b.setAttribute('data-so-disabled', '');
            if ('disabled' in b) b.disabled = true;
            b.setAttribute('aria-disabled', 'true');
            b.classList.add('so-cart-disabled');
          }
        } else if (b.hasAttribute('data-so-disabled')) {
          // 自分で止めたボタンだけ戻す（在庫切れなどfutureshop側の停止は触らない）
          b.removeAttribute('data-so-disabled');
          if ('disabled' in b) b.disabled = false;
          b.removeAttribute('aria-disabled');
          b.classList.remove('so-cart-disabled');
        }
      }
      if (!btns.length) return;
      if (!cartHint || !document.body.contains(cartHint)) {
        cartHint = document.createElement('div');
        cartHint.className = 'so-cart-hint';
        var anchor = hintAnchor(btns[0]);
        anchor.parentNode.insertBefore(cartHint, anchor.nextSibling);
      }
      cartHint.textContent = ok ? '' : (message || 'サイズを入力してください。');
    }

    // 案内文はボタンの真下に1行で出す（横並び＝flex/gridの枠の中だと縦に潰れるので、枠の外まで上がる）
    var cartHint = null;
    function hintAnchor(b) {
      var el = b;
      while (el.parentNode && el.parentNode !== document.body) {
        var d = window.getComputedStyle(el.parentNode).display;
        if (d.indexOf('flex') === -1 && d.indexOf('grid') === -1) break;
        el = el.parentNode;
      }
      return el;
    }

    wInput.addEventListener('input', update);
    hInput.addEventListener('input', update);
    // 入力欄を離れたら半角数字に整える（注文データを揃えるため）
    function normalize(e) {
      var n = toNumber(e.target.value);
      if (!isNaN(n)) e.target.value = String(n);
      update();
    }
    wInput.addEventListener('change', normalize);
    hInput.addEventListener('change', normalize);
    for (var r = 0; r < openRadios.length; r++) openRadios[r].addEventListener('change', update);
    update();
    // futureshopがボタンを後から描画する場合に備えて、読み込み完了後にも反映
    window.addEventListener('load', update);
    setTimeout(update, 1500);

    // 念のため、押されてしまった場合もカート投入を止める（futureshop標準の処理より先に捕まえる）
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest(CONFIG.cartButton + ', .so-cart-disabled');
      if (!btn) return;
      update();
      if (state.ok) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      alert(state.message || 'サイズを確認してください。');
      wInput.focus();
    }, true);

    var style = document.createElement('style');
    style.textContent =
      '.so-result{margin-top:10px;padding:10px 12px;border:1px solid #d9d9d9;border-radius:6px;background:#fafafa;font-size:14px;line-height:1.6}' +
      '.so-result__price strong{font-size:20px;color:#c00}' +
      '.so-result__msg{color:#c00;font-size:13px;white-space:pre-line}' +
      '.so-result.is-error{border-color:#c00;background:#fff5f5}' +
      '.so-cart-disabled{opacity:.4!important;cursor:not-allowed!important;filter:grayscale(1)}' +
      '.so-cart-hint{color:#c00;font-size:13px;margin-top:6px;text-align:center}' +
      '.so-cart-hint:empty{display:none}' +
      // カラー画像（丸い画像＋下に色名。選択中は枠）
      // テーマのスマホ用CSS（1色ずつ縦に並べる指定）に負けないよう !important を付ける
      '.so-swatch-wrap{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;gap:14px 8px}' +
      '.so-swatches .so-swatch-item{position:relative;display:block!important;float:none!important;width:auto!important;max-width:none!important;flex:0 0 auto!important;min-width:58px;margin:0!important;text-align:center;white-space:nowrap}' +
      '@media (max-width:600px){.so-swatch-wrap{display:grid!important;grid-template-columns:repeat(3,1fr);gap:14px 4px}.so-swatches .so-swatch-item{min-width:0}}' +
      '.so-swatches .so-swatch-item input[type="radio"]{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}' +
      '.so-swatches .so-swatch-item label{display:flex!important;flex-direction:column;align-items:center;gap:6px;cursor:pointer;font-size:11px;line-height:1.3;letter-spacing:0;padding:0!important}' +
      '.so-swatches .so-swatch-item label::before,.so-swatches .so-swatch-item label::after,.so-swatches .fs-c-radio__radioMark{display:none!important}' +
      '.so-swatch{display:block;width:50px;height:50px;border-radius:50%;padding:2px;border:2px solid transparent;box-sizing:content-box;transition:border-color .15s}' +
      '.so-swatch img{display:block;width:50px;height:50px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 1px rgba(0,0,0,.12)}' +
      '.so-swatch-item:hover .so-swatch{border-color:#ccc}' +
      '.so-swatch-item.is-selected .so-swatch{border-color:#333}' +
      '.so-swatch-item.is-selected label{font-weight:bold}' +
      '.so-swatch-item input:focus-visible+label .so-swatch{outline:2px solid #4a90e2;outline-offset:2px}' +
      '.so-swatch-current{font-weight:normal;margin-left:4px}';
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
