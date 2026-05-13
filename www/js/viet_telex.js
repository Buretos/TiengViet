/* ===== VIETNAMESE TELEX INPUT CONVERTER =====
 * Converts standard keyboard input to Vietnamese characters
 * using the Telex input method.
 *
 * Rules:
 *   aa→â  aw→ă  ee→ê  oo→ô  ow→ơ  uw/uw→ư  dd→đ
 *   Tones: s=sắc(´)  f=huyền(`)  r=hỏi(?)  x=ngã(~)  j=nặng(.)
 *   Type tone key after a vowel: as→á  af→à  ar→ả  ax→ã  aj→ạ
 *   z = remove tone / undo last conversion
 * ========================================= */
'use strict';

const VietTelex = (() => {
  // Toned vowel table: base → { tone_key → result }
  const TONES = {
    'a':  { s:'á', f:'à', r:'ả', x:'ã', j:'ạ', z:'a'  },
    'ă':  { s:'ắ', f:'ằ', r:'ẳ', x:'ẵ', j:'ặ', z:'ă'  },
    'â':  { s:'ấ', f:'ầ', r:'ẩ', x:'ẫ', j:'ậ', z:'â'  },
    'e':  { s:'é', f:'è', r:'ẻ', x:'ẽ', j:'ẹ', z:'e'  },
    'ê':  { s:'ế', f:'ề', r:'ể', x:'ễ', j:'ệ', z:'ê'  },
    'i':  { s:'í', f:'ì', r:'ỉ', x:'ĩ', j:'ị', z:'i'  },
    'o':  { s:'ó', f:'ò', r:'ỏ', x:'õ', j:'ọ', z:'o'  },
    'ô':  { s:'ố', f:'ồ', r:'ổ', x:'ỗ', j:'ộ', z:'ô'  },
    'ơ':  { s:'ớ', f:'ờ', r:'ở', x:'ỡ', j:'ợ', z:'ơ'  },
    'u':  { s:'ú', f:'ù', r:'ủ', x:'ũ', j:'ụ', z:'u'  },
    'ư':  { s:'ứ', f:'ừ', r:'ử', x:'ữ', j:'ự', z:'ư'  },
    'y':  { s:'ý', f:'ỳ', r:'ỷ', x:'ỹ', j:'ỵ', z:'y'  },
    // Toned vowels → change tone
    'á':  { f:'à', r:'ả', x:'ã', j:'ạ', z:'a', s:'á' },
    'à':  { s:'á', r:'ả', x:'ã', j:'ạ', z:'a', f:'à' },
    'ả':  { s:'á', f:'à', x:'ã', j:'ạ', z:'a', r:'ả' },
    'ã':  { s:'á', f:'à', r:'ả', j:'ạ', z:'a', x:'ã' },
    'ạ':  { s:'á', f:'à', r:'ả', x:'ã', z:'a', j:'ạ' },
    'ắ':  { f:'ằ', r:'ẳ', x:'ẵ', j:'ặ', z:'ă', s:'ắ' },
    'ằ':  { s:'ắ', r:'ẳ', x:'ẵ', j:'ặ', z:'ă', f:'ằ' },
    'ẳ':  { s:'ắ', f:'ằ', x:'ẵ', j:'ặ', z:'ă', r:'ẳ' },
    'ẵ':  { s:'ắ', f:'ằ', r:'ẳ', j:'ặ', z:'ă', x:'ẵ' },
    'ặ':  { s:'ắ', f:'ằ', r:'ẳ', x:'ẵ', z:'ă', j:'ặ' },
    'ấ':  { f:'ầ', r:'ẩ', x:'ẫ', j:'ậ', z:'â', s:'ấ' },
    'ầ':  { s:'ấ', r:'ẩ', x:'ẫ', j:'ậ', z:'â', f:'ầ' },
    'ẩ':  { s:'ấ', f:'ầ', x:'ẫ', j:'ậ', z:'â', r:'ẩ' },
    'ẫ':  { s:'ấ', f:'ầ', r:'ẩ', j:'ậ', z:'â', x:'ẫ' },
    'ậ':  { s:'ấ', f:'ầ', r:'ẩ', x:'ẫ', z:'â', j:'ậ' },
    'é':  { f:'è', r:'ẻ', x:'ẽ', j:'ẹ', z:'e', s:'é' },
    'è':  { s:'é', r:'ẻ', x:'ẽ', j:'ẹ', z:'e', f:'è' },
    'ẻ':  { s:'é', f:'è', x:'ẽ', j:'ẹ', z:'e', r:'ẻ' },
    'ẽ':  { s:'é', f:'è', r:'ẻ', j:'ẹ', z:'e', x:'ẽ' },
    'ẹ':  { s:'é', f:'è', r:'ẻ', x:'ẽ', z:'e', j:'ẹ' },
    'ế':  { f:'ề', r:'ể', x:'ễ', j:'ệ', z:'ê', s:'ế' },
    'ề':  { s:'ế', r:'ể', x:'ễ', j:'ệ', z:'ê', f:'ề' },
    'ể':  { s:'ế', f:'ề', x:'ễ', j:'ệ', z:'ê', r:'ể' },
    'ễ':  { s:'ế', f:'ề', r:'ể', j:'ệ', z:'ê', x:'ễ' },
    'ệ':  { s:'ế', f:'ề', r:'ể', x:'ễ', z:'ê', j:'ệ' },
    'í':  { f:'ì', r:'ỉ', x:'ĩ', j:'ị', z:'i', s:'í' },
    'ì':  { s:'í', r:'ỉ', x:'ĩ', j:'ị', z:'i', f:'ì' },
    'ỉ':  { s:'í', f:'ì', x:'ĩ', j:'ị', z:'i', r:'ỉ' },
    'ĩ':  { s:'í', f:'ì', r:'ỉ', j:'ị', z:'i', x:'ĩ' },
    'ị':  { s:'í', f:'ì', r:'ỉ', x:'ĩ', z:'i', j:'ị' },
    'ó':  { f:'ò', r:'ỏ', x:'õ', j:'ọ', z:'o', s:'ó' },
    'ò':  { s:'ó', r:'ỏ', x:'õ', j:'ọ', z:'o', f:'ò' },
    'ỏ':  { s:'ó', f:'ò', x:'õ', j:'ọ', z:'o', r:'ỏ' },
    'õ':  { s:'ó', f:'ò', r:'ỏ', j:'ọ', z:'o', x:'õ' },
    'ọ':  { s:'ó', f:'ò', r:'ỏ', x:'õ', z:'o', j:'ọ' },
    'ố':  { f:'ồ', r:'ổ', x:'ỗ', j:'ộ', z:'ô', s:'ố' },
    'ồ':  { s:'ố', r:'ổ', x:'ỗ', j:'ộ', z:'ô', f:'ồ' },
    'ổ':  { s:'ố', f:'ồ', x:'ỗ', j:'ộ', z:'ô', r:'ổ' },
    'ỗ':  { s:'ố', f:'ồ', r:'ổ', j:'ộ', z:'ô', x:'ỗ' },
    'ộ':  { s:'ố', f:'ồ', r:'ổ', x:'ỗ', z:'ô', j:'ộ' },
    'ớ':  { f:'ờ', r:'ở', x:'ỡ', j:'ợ', z:'ơ', s:'ớ' },
    'ờ':  { s:'ớ', r:'ở', x:'ỡ', j:'ợ', z:'ơ', f:'ờ' },
    'ở':  { s:'ớ', f:'ờ', x:'ỡ', j:'ợ', z:'ơ', r:'ở' },
    'ỡ':  { s:'ớ', f:'ờ', r:'ở', j:'ợ', z:'ơ', x:'ỡ' },
    'ợ':  { s:'ớ', f:'ờ', r:'ở', x:'ỡ', z:'ơ', j:'ợ' },
    'ú':  { f:'ù', r:'ủ', x:'ũ', j:'ụ', z:'u', s:'ú' },
    'ù':  { s:'ú', r:'ủ', x:'ũ', j:'ụ', z:'u', f:'ù' },
    'ủ':  { s:'ú', f:'ù', x:'ũ', j:'ụ', z:'u', r:'ủ' },
    'ũ':  { s:'ú', f:'ù', r:'ủ', j:'ụ', z:'u', x:'ũ' },
    'ụ':  { s:'ú', f:'ù', r:'ủ', x:'ũ', z:'u', j:'ụ' },
    'ứ':  { f:'ừ', r:'ử', x:'ữ', j:'ự', z:'ư', s:'ứ' },
    'ừ':  { s:'ứ', r:'ử', x:'ữ', j:'ự', z:'ư', f:'ừ' },
    'ử':  { s:'ứ', f:'ừ', x:'ữ', j:'ự', z:'ư', r:'ử' },
    'ữ':  { s:'ứ', f:'ừ', r:'ử', j:'ự', z:'ư', x:'ữ' },
    'ự':  { s:'ứ', f:'ừ', r:'ử', x:'ữ', z:'ư', j:'ự' },
    'ý':  { f:'ỳ', r:'ỷ', x:'ỹ', j:'ỵ', z:'y', s:'ý' },
    'ỳ':  { s:'ý', r:'ỷ', x:'ỹ', j:'ỵ', z:'y', f:'ỳ' },
    'ỷ':  { s:'ý', f:'ỳ', x:'ỹ', j:'ỵ', z:'y', r:'ỷ' },
    'ỹ':  { s:'ý', f:'ỳ', r:'ỷ', j:'ỵ', z:'y', x:'ỹ' },
    'ỵ':  { s:'ý', f:'ỳ', r:'ỷ', x:'ỹ', z:'y', j:'ỵ' },
  };

  // Vowel modification pairs: last2chars → replacement
  const MODS = {
    'aa':'â', 'aw':'ă', 'ee':'ê', 'oo':'ô', 'ow':'ơ', 'uw':'ư',
    'AA':'Â', 'AW':'Ă', 'EE':'Ê', 'OO':'Ô', 'OW':'Ơ', 'UW':'Ư',
    'dd':'đ', 'DD':'Đ',
  };

  const TONE_KEYS = new Set(['s','f','r','x','j','z']);
  const MOD_SECONDS = new Set(['a','e','o','w','d','A','E','O','W','D']);

  let _enabled = false;
  const _attachedInputs = new WeakMap();

  function enable() { _enabled = true; }
  function disable() { _enabled = false; }
  function isEnabled() { return _enabled; }

  function attach(el) {
    if (_attachedInputs.has(el)) return;
    const handler = (e) => _onBeforeInput(e, el);
    el.addEventListener('keydown', (e) => _onKeydown(e, el));
    _attachedInputs.set(el, handler);
  }

  function _onKeydown(e, el) {
    if (!_enabled) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.length !== 1) return;

    const key = e.key;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = el.value;

    // Only process if cursor is at end of selection (no range selected)
    if (start !== end) return;

    const before = val.substring(0, start);
    const after = val.substring(end);

    let replaced = false;

    // Try 3-char combination first (e.g. "aw" + tone → "ắ")
    if (TONE_KEYS.has(key) && before.length >= 2) {
      const last2 = before.slice(-2);
      const composed = last2 + key;
      // Check if last2 is a mod pair + tone
      const modVowel = MODS[last2] || MODS[last2.toLowerCase()];
      if (modVowel) {
        const mv = MODS[last2]; // may be undefined for uppercase
        const mvLow = MODS[last2.toLowerCase()];
        const base = mv || (last2.toLowerCase() !== last2 ? mvLow?.toUpperCase() : mvLow);
        if (base) {
          const baseForTone = base.toLowerCase();
          const toneResult = TONES[baseForTone]?.[key];
          if (toneResult) {
            const result = _matchCase(toneResult, base);
            e.preventDefault();
            el.value = before.slice(0, -2) + result + after;
            _setCursor(el, start - 2 + result.length);
            replaced = true;
          }
        }
      }
    }

    if (!replaced) {
      // Try tone on last character
      if (TONE_KEYS.has(key) && before.length >= 1) {
        const lastChar = before.slice(-1);
        const toneResult = TONES[lastChar]?.[key];
        if (toneResult) {
          e.preventDefault();
          el.value = before.slice(0, -1) + toneResult + after;
          _setCursor(el, start - 1 + toneResult.length);
          replaced = true;
        }
      }
    }

    if (!replaced) {
      // Try vowel modification (last char + new key)
      if (MOD_SECONDS.has(key) && before.length >= 1) {
        const pair = before.slice(-1) + key;
        const modResult = MODS[pair];
        if (modResult) {
          e.preventDefault();
          el.value = before.slice(0, -1) + modResult + after;
          _setCursor(el, start - 1 + modResult.length);
          replaced = true;
        }
      }
    }
    // If not replaced, let the key go through normally
  }

  function _setCursor(el, pos) {
    requestAnimationFrame(() => {
      el.selectionStart = pos;
      el.selectionEnd = pos;
    });
  }

  function _matchCase(char, ref) {
    // If reference is uppercase, return uppercase equivalent
    if (ref === ref.toUpperCase() && ref !== ref.toLowerCase()) {
      return char.toUpperCase();
    }
    return char;
  }

  return { enable, disable, isEnabled, attach };
})();
