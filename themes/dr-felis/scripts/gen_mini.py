#!/usr/bin/env python3
"""Generate the 8 mini-mode states: a compact chibi Dr. Felis, consistent with the full character."""
import os
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

EARS = ('<path d="M16 13 L13 5 L21 11 Z" fill="#141414"/>'
        '<path d="M29 13 L32 5 L24 11 Z" fill="#141414"/>'
        '<path d="M16.6 12 L14.8 7.4 L19.6 10.8 Z" fill="#3a3a3a"/>'
        '<path d="M28.4 12 L30.2 7.4 L25.4 10.8 Z" fill="#3a3a3a"/>')
HEAD = '<circle cx="22.5" cy="19" r="10.4" fill="#141414"/>'
BODY = '<ellipse cx="22.5" cy="33" rx="9.6" ry="7.6" fill="#141414"/>'
BELLY = '<ellipse cx="22.5" cy="33.5" rx="4.4" ry="5.4" fill="#fafafa"/>'
MUZZLE = '<ellipse cx="22.5" cy="21" rx="5" ry="3.8" fill="#fafafa"/>'
NOSE = '<path d="M21.1 19.6 L23.9 19.6 L22.5 21.2 Z" fill="#4a4a4a"/>'
FEET = ('<ellipse cx="18" cy="39.4" rx="2.8" ry="2" fill="#fafafa"/>'
        '<ellipse cx="27" cy="39.4" rx="2.8" ry="2" fill="#fafafa"/>')
SHADOW = '<ellipse cx="22.5" cy="40.5" rx="11" ry="2" fill="rgba(0,0,0,0.16)"/>'

MOUTH = {
 'smile': '<path d="M22.5 21.2 Q21 23 19.6 21.6" stroke="#4a4a4a" stroke-width="0.8" fill="none" stroke-linecap="round"/>'
          '<path d="M22.5 21.2 Q24 23 25.4 21.6" stroke="#4a4a4a" stroke-width="0.8" fill="none" stroke-linecap="round"/>',
 'grin':  '<path d="M19.4 21.4 Q22.5 24.6 25.6 21.4" stroke="#4a4a4a" stroke-width="0.9" fill="none" stroke-linecap="round"/>',
 'flat':  '<path d="M20.6 21.8 H24.4" stroke="#4a4a4a" stroke-width="0.8" stroke-linecap="round"/>',
}

def eyes(kind, cls=""):
    c = f' class="{cls}"' if cls else ""
    hi = '<circle cx="19.5" cy="16.4" r="0.45" fill="#fff"/><circle cx="26.5" cy="16.4" r="0.45" fill="#fff"/>'
    if kind == 'open':
        return (f'<g{c} style="transform-origin:center;transform-box:fill-box">'
                '<ellipse cx="18.6" cy="17" rx="2.6" ry="3" fill="#fafafa"/>'
                '<ellipse cx="26.4" cy="17" rx="2.6" ry="3" fill="#fafafa"/>'
                '<circle cx="19" cy="17.3" r="1.3" fill="#1a1a1a"/>'
                '<circle cx="26" cy="17.3" r="1.3" fill="#1a1a1a"/>' + hi + '</g>')
    if kind == 'wide':
        return ('<g>'
                '<ellipse cx="18.6" cy="17" rx="2.9" ry="3.3" fill="#fafafa"/>'
                '<ellipse cx="26.4" cy="17" rx="2.9" ry="3.3" fill="#fafafa"/>'
                '<circle cx="18.6" cy="17.1" r="1.7" fill="#1a1a1a"/>'
                '<circle cx="26.4" cy="17.1" r="1.7" fill="#1a1a1a"/>'
                '<circle cx="19.2" cy="16.4" r="0.5" fill="#fff"/><circle cx="27" cy="16.4" r="0.5" fill="#fff"/></g>')
    if kind == 'happy':
        return ('<g><path d="M16.2 17.8 Q18.6 14.8 21 17.8" stroke="#1a1a1a" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
                '<path d="M24 17.8 Q26.4 14.8 28.8 17.8" stroke="#1a1a1a" stroke-width="1.1" fill="none" stroke-linecap="round"/></g>')
    if kind == 'closed':
        return ('<g><path d="M16.2 17 Q18.6 19 21 17" stroke="#1a1a1a" stroke-width="1" fill="none" stroke-linecap="round"/>'
                '<path d="M24 17 Q26.4 19 28.8 17" stroke="#1a1a1a" stroke-width="1" fill="none" stroke-linecap="round"/></g>')
    if kind == 'wink':  # one eye open, one closed (peek)
        return ('<g><ellipse cx="18.6" cy="17" rx="2.6" ry="3" fill="#fafafa"/>'
                '<circle cx="19" cy="17.3" r="1.3" fill="#1a1a1a"/><circle cx="19.5" cy="16.4" r="0.45" fill="#fff"/>'
                '<path d="M24 17.4 Q26.4 19 28.8 17.4" stroke="#1a1a1a" stroke-width="1" fill="none" stroke-linecap="round"/></g>')
    return ''

def msvg(name, mouth, eyekind, css="", rootcls="", extra="", belly=True, eyecls=""):
    body = EARS + HEAD + BODY + (BELLY if belly else '') + MUZZLE + NOSE + MOUTH[mouth] + FEET
    style = f'<style>{css}</style>' if css else ''
    g_open = f'<g class="{rootcls}">' if rootcls else '<g>'
    out = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">{style}'
           f'{SHADOW}{g_open}{body}{eyes(eyekind, eyecls)}</g>{extra}</svg>')
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(out)
    print("wrote", name)

# mini-idle: eye-tracking version -> needs #eyes-js + #body-js + #shadow-js
IDLE_CSS = (".mb{animation:mB 3.4s ease-in-out infinite;transform-origin:22.5px 40px}"
            "@keyframes mB{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.03)}}")
body = EARS + HEAD + BODY + BELLY + MUZZLE + NOSE + MOUTH['smile'] + FEET
mini_idle = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><style>{IDLE_CSS}</style>'
             f'<g id="shadow-js">{SHADOW}</g>'
             f'<g id="body-js"><g class="mb">{body}</g></g>'
             f'<g id="eyes-js">{eyes("open")}</g></svg>')
with open(os.path.join(OUT, 'mini-idle.svg'), 'w') as f:
    f.write(mini_idle)
print("wrote mini-idle.svg")

# mini-enter: slide up into view
ENTER_CSS = ".en{animation:mEn .5s ease-out;transform-origin:22.5px 44px}@keyframes mEn{0%{transform:translateY(14px)}100%{transform:translateY(0)}}"
msvg('mini-enter.svg', 'smile', 'open', css=ENTER_CSS, rootcls='en')

# mini-peek: one eye wink, lean
PEEK_CSS = ".pk{animation:mPk 2.4s ease-in-out infinite;transform-origin:22.5px 40px}@keyframes mPk{0%,100%{transform:translateX(0) rotate(0)}50%{transform:translateX(1.4px) rotate(3deg)}}"
msvg('mini-peek.svg', 'smile', 'wink', css=PEEK_CSS, rootcls='pk')

# mini-alert: wide eyes, bob + !
ALERT_CSS = (".al{animation:mAl .4s ease-in-out infinite;transform-origin:22.5px 40px}@keyframes mAl{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.4px)}}")
msvg('mini-alert.svg', 'flat', 'wide', css=ALERT_CSS, rootcls='al',
     extra='<text x="32" y="12" font-family="sans-serif" font-size="7" fill="#e8643c" font-weight="bold">!</text>')

# mini-happy: ^^ grin bounce + sparkle
HAPPY_CSS = (".hb{animation:mHb .7s ease-in-out infinite;transform-origin:22.5px 41px}@keyframes mHb{0%,100%{transform:translateY(0)}40%{transform:translateY(-2px)}}"
             ".sp{animation:mSp 1s ease-in-out infinite}@keyframes mSp{0%,100%{opacity:.3}50%{opacity:1}}")
msvg('mini-happy.svg', 'grin', 'happy', css=HAPPY_CSS, rootcls='hb',
     extra='<g class="sp"><path d="M34 14 l0.6 1.8 1.8 0.6 -1.8 0.6 -0.6 1.8 -0.6 -1.8 -1.8 -0.6 1.8 -0.6 Z" fill="#ffd84a"/></g>')

# mini-sleep: closed eyes, z float
SLEEP_CSS = (".sl{animation:mSl 4s ease-in-out infinite;transform-origin:22.5px 41px}@keyframes mSl{0%,100%{transform:scale(1,1)}50%{transform:scale(1.02,0.98)}}"
             ".zz{animation:mZz 3s ease-in-out infinite}@keyframes mZz{0%{opacity:0;transform:translate(0,2px)}40%{opacity:1}100%{opacity:0;transform:translate(2px,-5px)}}")
msvg('mini-sleep.svg', 'flat', 'closed', css=SLEEP_CSS, rootcls='sl',
     extra='<text x="32" y="13" font-family="sans-serif" font-size="6" fill="#7a8aa0" class="zz">z</text>')

# mini-enter-sleep: slide in already drowsy
ES_CSS = (".es{animation:mEs .6s ease-out;transform-origin:22.5px 44px}@keyframes mEs{0%{transform:translateY(14px)}100%{transform:translateY(0)}}")
msvg('mini-enter-sleep.svg', 'flat', 'closed', css=ES_CSS, rootcls='es',
     extra='<text x="32" y="13" font-family="sans-serif" font-size="5.5" fill="#7a8aa0">z</text>')

# mini-crabwalk: side scuttle wobble
CRAB_CSS = (".cw{animation:mCw .5s ease-in-out infinite;transform-origin:22.5px 40px}@keyframes mCw{0%,100%{transform:translateX(-1.4px) rotate(-3deg)}50%{transform:translateX(1.4px) rotate(3deg)}}")
msvg('mini-crabwalk.svg', 'smile', 'open', css=CRAB_CSS, rootcls='cw')

# optional mini-working: tiny focused taps
WORK_CSS = (".mw{animation:mMw .35s ease-in-out infinite;transform-origin:22.5px 40px}@keyframes mMw{0%,100%{transform:translateY(0)}50%{transform:translateY(0.6px)}}")
msvg('mini-working.svg', 'flat', 'open', css=WORK_CSS, rootcls='mw',
     extra='<rect x="17" y="36" width="11" height="1.8" rx="0.8" fill="#2b3a4a"/>')

print("MINI DONE")
