#!/usr/bin/env python3
"""Generate the full Dr. Felis tuxedo-cat theme asset set as SVG with CSS animation.
All states share the same canonical body so the character is identical across states."""
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(OUT, exist_ok=True)

# ---- canonical body parts (verified visually) ----
TAIL = '<path d="M30.5 33 C36 31.5 39 33.5 41.5 30.5 C40.8 29.8 41 31 41.6 31.2 C42 33.6 41 36 38.8 37 C36 38.2 32 37.5 30 35.2 Z" fill="#141414"/>'
EARS = ('<path d="M16 12 L12.5 3.5 L21 10 Z" fill="#141414"/>'
        '<path d="M29 12 L32.5 3.5 L24 10 Z" fill="#141414"/>'
        '<path d="M16.6 11 L14.6 6 L19.4 9.8 Z" fill="#3a3a3a"/>'
        '<path d="M28.4 11 L30.4 6 L25.6 9.8 Z" fill="#3a3a3a"/>')
TUFTS = ('<path d="M14.5 15 L10.5 13.5 L14.5 17 Z" fill="#141414"/>'
         '<path d="M30.5 15 L34.5 13.5 L30.5 17 Z" fill="#141414"/>')
HEAD = '<circle cx="22.5" cy="14" r="8.6" fill="#141414"/>'
BODY = ('<path d="M14.4 18 C12.8 22 13.4 30 14 36 C14.3 40 18 42 22.5 42 C27 42 30.7 40 31 36 '
        'C31.6 30 32.2 22 30.6 18 C28 16.4 17 16.4 14.4 18 Z" fill="#141414"/>')
BIB = ('<path d="M22.5 17 C20.2 19 20.8 21 19.6 23 C20.8 23.6 19.2 25 20 26 C18.6 26.6 20 28 19 29 '
       'C20.4 29.4 18.8 31 19.4 32.4 C18.2 33.4 19.8 34.6 19.2 36 C20.6 38 24.4 38 26 36 '
       'C25.2 34.6 26.6 33.6 25.6 32.4 C26.4 31 24.8 29.6 26 29 C25 28 26.4 26.6 25 26 '
       'C25.8 25 24.4 23.8 25.4 23 C24.4 21 24.8 19 22.5 17 Z" fill="#fafafa"/>')
MUZZLE = '<ellipse cx="22.5" cy="16" rx="4.6" ry="3.4" fill="#fafafa"/>'
NOSE = '<path d="M21.3 14.7 L23.7 14.7 L22.5 16.2 Z" fill="#4a4a4a"/>'
FEET = ('<ellipse cx="18.4" cy="41" rx="3.1" ry="2.3" fill="#fafafa"/>'
        '<ellipse cx="26.6" cy="41" rx="3.1" ry="2.3" fill="#fafafa"/>'
        '<path d="M16.8 40.4 V42.6 M18.4 40.2 V42.8 M20 40.4 V42.6" stroke="#cfcfcf" stroke-width="0.4"/>'
        '<path d="M25 40.4 V42.6 M26.6 40.2 V42.8 M28.2 40.4 V42.6" stroke="#cfcfcf" stroke-width="0.4"/>')

def paws(cls=""):
    c = f' class="{cls}"' if cls else ""
    return (f'<g{c} style="transform-origin:22.5px 31px">'
            '<ellipse cx="20.6" cy="31.4" rx="2.5" ry="2" fill="#fafafa"/>'
            '<ellipse cx="24.4" cy="31.4" rx="2.5" ry="2" fill="#fafafa"/></g>')

# ---- mouth variants ----
MOUTH = {
 'smile': '<path d="M22.5 16.2 Q21.2 17.8 19.9 16.6" stroke="#4a4a4a" stroke-width="0.7" fill="none" stroke-linecap="round"/>'
          '<path d="M22.5 16.2 Q23.8 17.8 25.1 16.6" stroke="#4a4a4a" stroke-width="0.7" fill="none" stroke-linecap="round"/>',
 'grin':  '<path d="M19.6 16.4 Q22.5 19.4 25.4 16.4" stroke="#4a4a4a" stroke-width="0.8" fill="none" stroke-linecap="round"/>',
 'flat':  '<path d="M20.6 16.8 H24.4" stroke="#4a4a4a" stroke-width="0.7" stroke-linecap="round"/>',
 'o':     '<ellipse cx="22.5" cy="17" rx="1.5" ry="2" fill="#5a3a3a"/>',
 'small': '<ellipse cx="22.5" cy="16.8" rx="1" ry="1.2" fill="#5a3a3a"/>',
 'wavy':  '<path d="M20.4 16.8 Q21.4 16 22.5 16.8 Q23.6 17.6 24.6 16.8" stroke="#4a4a4a" stroke-width="0.7" fill="none" stroke-linecap="round"/>',
}

# ---- eye variants (drawn inside an eyes group) ----
def eyes(kind, cls=""):
    c = f' class="{cls}"' if cls else ""
    L, R = 19, 26
    hi = '<circle cx="19.8" cy="12.4" r="0.4" fill="#fff"/><circle cx="26" cy="12.4" r="0.4" fill="#fff"/>'
    if kind == 'open':
        return (f'<g{c} style="transform-origin:center;transform-box:fill-box">'
                f'<ellipse cx="{L}" cy="12.6" rx="2.3" ry="2.7" fill="#fafafa"/>'
                f'<ellipse cx="{R}" cy="12.6" rx="2.3" ry="2.7" fill="#fafafa"/>'
                '<circle cx="19.4" cy="12.9" r="1.15" fill="#1a1a1a"/>'
                '<circle cx="25.6" cy="12.9" r="1.15" fill="#1a1a1a"/>' + hi + '</g>')
    if kind == 'up':
        return (f'<g{c}>'
                f'<ellipse cx="{L}" cy="12.6" rx="2.3" ry="2.7" fill="#fafafa"/>'
                f'<ellipse cx="{R}" cy="12.6" rx="2.3" ry="2.7" fill="#fafafa"/>'
                '<circle cx="19.2" cy="11.2" r="1.1" fill="#1a1a1a"/>'
                '<circle cx="25.8" cy="11.2" r="1.1" fill="#1a1a1a"/></g>')
    if kind == 'happy':  # ^ ^ closed upward arcs
        return (f'<g{c}>'
                f'<path d="M16.8 13.2 Q19 10.6 21.2 13.2" stroke="#1a1a1a" stroke-width="1" fill="none" stroke-linecap="round"/>'
                f'<path d="M23.8 13.2 Q26 10.6 28.2 13.2" stroke="#1a1a1a" stroke-width="1" fill="none" stroke-linecap="round"/></g>')
    if kind == 'closed':  # gentle downward arcs (sleeping)
        return (f'<g{c}>'
                f'<path d="M16.8 12.6 Q19 14.4 21.2 12.6" stroke="#1a1a1a" stroke-width="0.9" fill="none" stroke-linecap="round"/>'
                f'<path d="M23.8 12.6 Q26 14.4 28.2 12.6" stroke="#1a1a1a" stroke-width="0.9" fill="none" stroke-linecap="round"/></g>')
    if kind == 'wide':
        return (f'<g{c}>'
                f'<ellipse cx="{L}" cy="12.6" rx="2.6" ry="3" fill="#fafafa"/>'
                f'<ellipse cx="{R}" cy="12.6" rx="2.6" ry="3" fill="#fafafa"/>'
                '<circle cx="19" cy="12.7" r="1.5" fill="#1a1a1a"/>'
                '<circle cx="26" cy="12.7" r="1.5" fill="#1a1a1a"/>'
                '<circle cx="19.6" cy="12.1" r="0.45" fill="#fff"/><circle cx="26.6" cy="12.1" r="0.45" fill="#fff"/></g>')
    if kind == 'half':  # droopy
        return (f'<g{c}>'
                f'<path d="M16.8 12.4 Q19 13.2 21.2 12.4" stroke="#fafafa" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
                f'<path d="M23.8 12.4 Q26 13.2 28.2 12.4" stroke="#fafafa" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
                '<circle cx="19.3" cy="13" r="0.8" fill="#1a1a1a"/><circle cx="25.7" cy="13" r="0.8" fill="#1a1a1a"/></g>')
    if kind == 'dizzy':  # x x / spiral-ish for error
        return (f'<g{c}>'
                f'<path d="M17.4 11.2 L20.6 14 M20.6 11.2 L17.4 14" stroke="#1a1a1a" stroke-width="0.9" stroke-linecap="round"/>'
                f'<path d="M24.4 11.2 L27.6 14 M27.6 11.2 L24.4 14" stroke="#1a1a1a" stroke-width="0.9" stroke-linecap="round"/></g>')
    return ''

# ---- assembly ----
def svg(parts, css="", eye_track=False, extra_top="", extra_bottom=""):
    style = f'<style>{css}</style>' if css else ''
    if eye_track:
        # eyes split into their own #eyes-js group for cursor tracking
        body_inner = ''.join(parts['body'])
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">{style}'
                f'<g id="shadow-js"><ellipse cx="22.5" cy="42" rx="11.5" ry="2.1" fill="rgba(0,0,0,0.16)"/></g>'
                f'<g id="body-js"><g class="breathe">{body_inner}</g></g>'
                f'<g id="eyes-js">{parts["eyes"]}</g>{extra_top}</svg>')
    shadow = '<ellipse cx="22.5" cy="42" rx="11.5" ry="2.1" fill="rgba(0,0,0,0.16)"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">{style}'
            f'{extra_bottom}{shadow}<g class="{parts.get("rootcls","")}">'
            f'{"".join(parts["body"])}{parts["eyes"]}</g>{extra_top}</svg>')

def body_parts(mouth='smile', extra_face='', extra_body='', paw_cls=''):
    return [TAIL, EARS, TUFTS, HEAD, BODY, BIB, MUZZLE, NOSE, MOUTH[mouth],
            paws(paw_cls), FEET, extra_face, extra_body]

def write(name, content):
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(content)
    print("wrote", name)

# ====================== NORMAL STATES ======================

# idle (eye tracking + breathe + blink) -- written separately to keep verified file, regenerate identically
IDLE_CSS = (".breathe{animation:dfBreathe 3.4s ease-in-out infinite;transform-origin:22.5px 40px}"
            "@keyframes dfBreathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.025) translateY(-0.3px)}}"
            ".blink{animation:dfBlink 5.2s ease-in-out infinite;transform-origin:center;transform-box:fill-box}"
            "@keyframes dfBlink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(0.12)}}")
write('idle.svg', svg({'body': body_parts('smile'), 'eyes': eyes('open','blink')},
                      css=IDLE_CSS, eye_track=True))

# thinking: look up, thought bubble with pulsing dots, gentle bob
THINK_CSS = (".bob{animation:dfBob 2.6s ease-in-out infinite;transform-origin:22.5px 40px}"
             "@keyframes dfBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-0.8px)}}"
             ".d1{animation:dfDot 1.5s ease-in-out infinite}.d2{animation:dfDot 1.5s ease-in-out .25s infinite}"
             ".d3{animation:dfDot 1.5s ease-in-out .5s infinite}"
             "@keyframes dfDot{0%,100%{opacity:.3}50%{opacity:1}}")
think_bubble = ('<g transform="translate(0,0)">'
                '<circle cx="33" cy="9" r="3.4" fill="#eef2f7" stroke="#c7d0db" stroke-width="0.4"/>'
                '<circle cx="29.5" cy="13" r="1.4" fill="#eef2f7"/>'
                '<circle cx="31.4" cy="8" r="0.7" fill="#7a8aa0" class="d1"/>'
                '<circle cx="33" cy="9" r="0.7" fill="#7a8aa0" class="d2"/>'
                '<circle cx="34.6" cy="10" r="0.7" fill="#7a8aa0" class="d3"/></g>')
write('thinking.svg', svg({'body': body_parts('small'), 'eyes': eyes('up'), 'rootcls':'bob'},
                          css=THINK_CSS, extra_top=think_bubble))

# working (base): paws tapping a keyboard bar
WORK_CSS = (".tap{animation:dfTap .5s ease-in-out infinite;transform-origin:22.5px 31px}"
            "@keyframes dfTap{0%,100%{transform:translateY(0)}50%{transform:translateY(0.7px)}}")
keyboard = '<rect x="16.5" y="33.4" width="12" height="2.2" rx="1" fill="#2b3a4a"/><rect x="17.3" y="33.9" width="10.4" height="0.5" rx="0.25" fill="#5b6b7b"/>'
write('working.svg', svg({'body': body_parts('smile', extra_body=keyboard, paw_cls='tap'),
                          'eyes': eyes('open')}, css=WORK_CSS))

# typing (working tier 1): same as working but faster taps + focus eyes
write('typing.svg', svg({'body': body_parts('smile', extra_body=keyboard, paw_cls='tap'),
                         'eyes': eyes('open')},
                        css=WORK_CSS.replace('.5s','0.32s')))

# juggling (working tier 2 / juggling state): three orbiting balls above paws
JUG_CSS = (".o1{animation:dfO1 1.1s linear infinite}.o2{animation:dfO2 1.1s linear infinite}.o3{animation:dfO3 1.1s linear infinite}"
           "@keyframes dfO1{0%{transform:translate(0,0)}50%{transform:translate(2px,-6px)}100%{transform:translate(0,0)}}"
           "@keyframes dfO2{0%{transform:translate(0,-6px)}50%{transform:translate(-2px,0)}100%{transform:translate(0,-6px)}}"
           "@keyframes dfO3{0%{transform:translate(0,-3px)}50%{transform:translate(0,-9px)}100%{transform:translate(0,-3px)}}")
balls = ('<circle cx="20" cy="27" r="1.5" fill="#e8643c" class="o1"/>'
         '<circle cx="25" cy="27" r="1.5" fill="#3c9be8" class="o2"/>'
         '<circle cx="22.5" cy="25" r="1.5" fill="#e8c83c" class="o3"/>')
write('juggling.svg', svg({'body': body_parts('grin', extra_body=''), 'eyes': eyes('open')},
                          css=JUG_CSS, extra_top=balls))

# building (working tier 3): little hammer tapping + blocks
BUILD_CSS = (".ham{animation:dfHam .6s ease-in-out infinite;transform-origin:18px 30px}"
             "@keyframes dfHam{0%,100%{transform:rotate(-18deg)}50%{transform:rotate(12deg)}}")
build_props = ('<g class="ham"><rect x="16.5" y="24" width="1.4" height="6" rx="0.6" fill="#8a5a2a"/>'
               '<rect x="14.5" y="22.5" width="5.4" height="2.4" rx="0.6" fill="#5b6b7b"/></g>'
               '<rect x="24" y="34" width="2.6" height="2.6" fill="#c98a4a"/><rect x="26.8" y="34" width="2.6" height="2.6" fill="#a86a2a"/>')
write('building.svg', svg({'body': body_parts('grin', extra_body=build_props), 'eyes': eyes('open')},
                          css=BUILD_CSS))

# error: dizzy eyes, wavy mouth, shake + red spark
ERR_CSS = (".shake{animation:dfShake .35s ease-in-out infinite}"
           "@keyframes dfShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-1px)}75%{transform:translateX(1px)}}"
           ".spark{animation:dfSpark .8s ease-in-out infinite}@keyframes dfSpark{0%,100%{opacity:.4}50%{opacity:1}}")
err_props = ('<g class="spark"><path d="M32 8 l1.4 2.6 2.6 0.4 -1.8 1.9 0.5 2.7 -2.7 -1.4 -2.7 1.4 0.5 -2.7 -1.8 -1.9 2.6 -0.4 Z" fill="#e8433c"/></g>')
write('error.svg', svg({'body': body_parts('wavy'), 'eyes': eyes('dizzy'), 'rootcls':'shake'},
                       css=ERR_CSS, extra_top=err_props))

# happy / attention: grin, happy eyes, bounce + sparkles
HAPPY_CSS = (".bounce{animation:dfBounce 0.7s ease-in-out infinite;transform-origin:22.5px 42px}"
             "@keyframes dfBounce{0%,100%{transform:translateY(0)}40%{transform:translateY(-2.2px)}}"
             ".spk{animation:dfSpk 1s ease-in-out infinite}@keyframes dfSpk{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}")
sparkles = ('<g class="spk" style="transform-origin:9px 12px"><path d="M9 9 l0.7 2 2 0.7 -2 0.7 -0.7 2 -0.7 -2 -2 -0.7 2 -0.7 Z" fill="#ffd84a"/></g>'
            '<g class="spk" style="transform-origin:36px 16px"><path d="M36 14 l0.5 1.5 1.5 0.5 -1.5 0.5 -0.5 1.5 -0.5 -1.5 -1.5 -0.5 1.5 -0.5 Z" fill="#ffd84a"/></g>')
write('happy.svg', svg({'body': body_parts('grin'), 'eyes': eyes('happy'), 'rootcls':'bounce'},
                       css=HAPPY_CSS, extra_top=sparkles))

# notification: wide eyes, small o mouth, wiggle + bell
NOTIF_CSS = (".wig{animation:dfWig 1.2s ease-in-out infinite;transform-origin:22.5px 40px}"
             "@keyframes dfWig{0%,100%{transform:rotate(0)}25%{transform:rotate(-3deg)}75%{transform:rotate(3deg)}}"
             ".bell{animation:dfBell 1.2s ease-in-out infinite;transform-origin:33px 7px}"
             "@keyframes dfBell{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(10deg)}}")
bell = ('<g class="bell"><path d="M30.5 12 C30.5 9 31.3 7 33 6.4 C34.7 7 35.5 9 35.5 12 Z" fill="#ffce4a" stroke="#c79a2a" stroke-width="0.4"/>'
        '<rect x="30" y="12" width="6" height="1.2" rx="0.6" fill="#c79a2a"/><circle cx="33" cy="14" r="0.8" fill="#c79a2a"/>'
        '<circle cx="33" cy="5.6" r="0.7" fill="#c79a2a"/></g>')
write('notification.svg', svg({'body': body_parts('small'), 'eyes': eyes('wide'), 'rootcls':'wig'},
                              css=NOTIF_CSS, extra_top=bell))

# sweeping (context compaction): broom sway
SWEEP_CSS = (".sway{animation:dfSway 1.4s ease-in-out infinite;transform-origin:22.5px 40px}"
             "@keyframes dfSway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}"
             ".brm{animation:dfBrm 1.4s ease-in-out infinite;transform-origin:30px 30px}"
             "@keyframes dfBrm{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(8deg)}}")
broom = ('<g class="brm"><rect x="29.4" y="24" width="1.2" height="12" rx="0.6" fill="#8a5a2a"/>'
         '<path d="M27 36 L33 36 L34.4 41 L25.6 41 Z" fill="#d8b24a"/>'
         '<path d="M26.4 41 V43 M28 41 V43 M29.6 41 V43 M31.2 41 V43 M32.8 41 V43 M34.4 41 V43" stroke="#b8922a" stroke-width="0.4"/></g>')
write('sweeping.svg', svg({'body': body_parts('smile'), 'eyes': eyes('open'), 'rootcls':'sway'},
                          css=SWEEP_CSS, extra_top=broom))

# carrying (worktree creation): carry a box, walk bob
CARRY_CSS = (".walk{animation:dfWalk 0.7s ease-in-out infinite;transform-origin:22.5px 42px}"
             "@keyframes dfWalk{0%,100%{transform:translateY(0) rotate(-1deg)}50%{transform:translateY(-1px) rotate(1deg)}}")
box = ('<g><rect x="17.5" y="26" width="10" height="7.5" rx="0.6" fill="#c98a4a" stroke="#8a5a2a" stroke-width="0.5"/>'
       '<path d="M17.5 29 H27.5 M22.5 26 V33.5" stroke="#8a5a2a" stroke-width="0.5"/></g>')
write('carrying.svg', svg({'body': body_parts('grin', extra_body=box, paw_cls=''), 'eyes': eyes('open'), 'rootcls':'walk'},
                          css=CARRY_CSS))

# ---- sleep sequence ----
# yawning: open mouth + small z, head tilt
YAWN_CSS = (".yawn{animation:dfYawn 2.4s ease-in-out infinite;transform-origin:22.5px 17px}"
            "@keyframes dfYawn{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.4)}}")
yawn_mouth = '<ellipse cx="22.5" cy="17.2" rx="2" ry="2.6" fill="#5a3a3a" class="yawn"/>'
yawn_body = [TAIL, EARS, TUFTS, HEAD, BODY, BIB, MUZZLE, NOSE, yawn_mouth, paws(), FEET]
write('yawning.svg', svg({'body': yawn_body, 'eyes': eyes('half')},
                         css=YAWN_CSS, extra_top='<text x="33" y="10" font-family="sans-serif" font-size="5" fill="#7a8aa0">z</text>'))

# dozing: droopy half eyes, slow gentle sink, small z
DOZE_CSS = (".doze{animation:dfDoze 3s ease-in-out infinite;transform-origin:22.5px 42px}"
            "@keyframes dfDoze{0%,100%{transform:translateY(0)}50%{transform:translateY(0.6px)}}"
            ".zf{animation:dfZf 3s ease-in-out infinite}@keyframes dfZf{0%{opacity:0;transform:translateY(2px)}50%{opacity:1}100%{opacity:0;transform:translateY(-3px)}}")
write('dozing.svg', svg({'body': body_parts('flat'), 'eyes': eyes('half'), 'rootcls':'doze'},
                        css=DOZE_CSS, extra_top='<text x="32" y="11" font-family="sans-serif" font-size="5.5" fill="#7a8aa0" class="zf">z</text>'))

# collapsing: tilt over toward lying down
COLL_CSS = (".coll{animation:dfColl 1.4s ease-in forwards;transform-origin:22.5px 42px}"
            "@keyframes dfColl{0%{transform:rotate(0)}100%{transform:rotate(10deg) translateY(1px)}}")
write('collapsing.svg', svg({'body': body_parts('flat'), 'eyes': eyes('closed'), 'rootcls':'coll'},
                            css=COLL_CSS))

# sleeping: lying-ish (whole cat shifted/rounded), closed eyes, floating Zzz
SLEEP_CSS = (".sleep{animation:dfSleep 4s ease-in-out infinite;transform-origin:22.5px 42px}"
             "@keyframes dfSleep{0%,100%{transform:scale(1,1)}50%{transform:scale(1.02,0.99)}}"
             ".z1{animation:dfZ 3.2s ease-in-out infinite}.z2{animation:dfZ 3.2s ease-in-out 1s infinite}.z3{animation:dfZ 3.2s ease-in-out 2s infinite}"
             "@keyframes dfZ{0%{opacity:0;transform:translate(0,2px) scale(.7)}30%{opacity:1}100%{opacity:0;transform:translate(3px,-6px) scale(1.1)}}")
zzz = ('<text x="30" y="13" font-family="sans-serif" font-size="4.5" fill="#8a96a8" class="z1">z</text>'
       '<text x="33" y="9" font-family="sans-serif" font-size="6" fill="#7a8aa0" class="z2">Z</text>'
       '<text x="37" y="5" font-family="sans-serif" font-size="7.5" fill="#6a7a92" class="z3">Z</text>')
write('sleeping.svg', svg({'body': body_parts('flat'), 'eyes': eyes('closed'), 'rootcls':'sleep'},
                          css=SLEEP_CSS, extra_top=zzz))

# waking: stretch up, half eyes
WAKE_CSS = (".wake{animation:dfWake 1.4s ease-in-out;transform-origin:22.5px 42px}"
            "@keyframes dfWake{0%{transform:scaleY(0.96)}40%{transform:scaleY(1.06)}100%{transform:scaleY(1)}}")
write('waking.svg', svg({'body': body_parts('o'), 'eyes': eyes('half'), 'rootcls':'wake'},
                        css=WAKE_CSS, extra_top='<text x="32" y="10" font-family="sans-serif" font-size="4.5" fill="#7a8aa0">!</text>'))

# ---- idle random animations ----
# idle-look: glance left/right
LOOK_CSS = (".look{animation:dfLook 6s ease-in-out infinite}"
            "@keyframes dfLook{0%,100%{transform:translateX(0)}25%{transform:translateX(-1.2px)}60%{transform:translateX(1.2px)}}")
write('idle-look.svg', svg({'body': body_parts('smile'), 'eyes': eyes('open','look')}, css=LOOK_CSS))

# idle-reading: hold a small book, eyes down
READ_CSS = ".rd{animation:dfRd 4s ease-in-out infinite}@keyframes dfRd{0%,100%{transform:translateY(0)}50%{transform:translateY(-0.5px)}}"
book = ('<g><path d="M17 30 L22.5 28.6 L22.5 35 L17 36.4 Z" fill="#c0451f"/>'
        '<path d="M28 30 L22.5 28.6 L22.5 35 L28 36.4 Z" fill="#d9603a"/>'
        '<path d="M22.5 28.6 V35" stroke="#7a2a12" stroke-width="0.4"/></g>')
read_eyes = ('<g><ellipse cx="19" cy="12.8" rx="2.3" ry="2.5" fill="#fafafa"/>'
             '<ellipse cx="26" cy="12.8" rx="2.3" ry="2.5" fill="#fafafa"/>'
             '<circle cx="19.2" cy="13.8" r="1" fill="#1a1a1a"/><circle cx="25.8" cy="13.8" r="1" fill="#1a1a1a"/></g>')
write('idle-reading.svg', svg({'body': body_parts('smile', extra_body=book), 'eyes': read_eyes, 'rootcls':'rd'}, css=READ_CSS))

# ---- reactions ----
# clickLeft: lean left, surprised
RL_CSS = ".rl{animation:dfRL .5s ease-out;transform-origin:22.5px 42px}@keyframes dfRL{0%{transform:rotate(0)}50%{transform:rotate(-9deg)}100%{transform:rotate(0)}}"
write('react-left.svg', svg({'body': body_parts('o'), 'eyes': eyes('wide'), 'rootcls':'rl'}, css=RL_CSS))
RR_CSS = ".rr{animation:dfRR .5s ease-out;transform-origin:22.5px 42px}@keyframes dfRR{0%{transform:rotate(0)}50%{transform:rotate(9deg)}100%{transform:rotate(0)}}"
write('react-right.svg', svg({'body': body_parts('o'), 'eyes': eyes('wide'), 'rootcls':'rr'}, css=RR_CSS))
# annoyed: flat mouth, half eyes, small shake
ANN_CSS = ".ann{animation:dfAnn .3s ease-in-out 3;transform-origin:22.5px 42px}@keyframes dfAnn{0%,100%{transform:translateX(0)}50%{transform:translateX(1px)}}"
write('react-annoyed.svg', svg({'body': body_parts('flat'), 'eyes': eyes('half'), 'rootcls':'ann'}, css=ANN_CSS,
                               extra_top='<text x="31" y="11" font-family="sans-serif" font-size="6" fill="#9aa6b8">~</text>'))
# double: flail / spin-ish wiggle, happy
DBL_CSS = ".dbl{animation:dfDbl .6s ease-in-out infinite;transform-origin:22.5px 42px}@keyframes dfDbl{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}"
write('react-double.svg', svg({'body': body_parts('grin'), 'eyes': eyes('happy'), 'rootcls':'dbl'}, css=DBL_CSS, extra_top=sparkles))
# drag: dangling, wide eyes (loops)
DRAG_CSS = ".drag{animation:dfDrag 1s ease-in-out infinite;transform-origin:22.5px 6px}@keyframes dfDrag{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}"
write('react-drag.svg', svg({'body': body_parts('o'), 'eyes': eyes('wide'), 'rootcls':'drag'}, css=DRAG_CSS))
DRAGL_CSS = ".dragl{animation:dfDragL 1s ease-in-out infinite;transform-origin:22.5px 6px}@keyframes dfDragL{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(-4deg)}}"
write('react-drag-left.svg', svg({'body': body_parts('o'), 'eyes': eyes('wide'), 'rootcls':'dragl'}, css=DRAGL_CSS))
DRAGR_CSS = ".dragr{animation:dfDragR 1s ease-in-out infinite;transform-origin:22.5px 6px}@keyframes dfDragR{0%,100%{transform:rotate(12deg)}50%{transform:rotate(4deg)}}"
write('react-drag-right.svg', svg({'body': body_parts('o'), 'eyes': eyes('wide'), 'rootcls':'dragr'}, css=DRAGR_CSS))

print("NORMAL DONE")
