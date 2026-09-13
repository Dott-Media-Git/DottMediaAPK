"""Exercise the release APK's login inputs with the Android software keyboard."""
import pathlib
import re
import subprocess
import time
import xml.etree.ElementTree as ET

out = pathlib.Path('build/android-check')
out.mkdir(parents=True, exist_ok=True)

def adb(*args):
    return subprocess.check_output(['adb', *args], text=True, timeout=30)

def tree():
    adb('shell', 'uiautomator', 'dump', '/sdcard/dotti-ui.xml')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/dotti-ui.xml'))

def find(attribute, value):
    for _ in range(8):
        for node in tree().iter('node'):
            if node.attrib.get(attribute, '').lower().endswith(value.lower()):
                return node
        time.sleep(1)
    raise AssertionError(f'Element not found: {attribute}={value}')

def tap(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.attrib['bounds']))
    adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(1)

def keyboard_visible():
    state = adb('shell', 'dumpsys', 'input_method')
    if not re.search(r'(?:mInputShown|isInputViewShown|mIsInputViewShown)=true', state):
        (out / 'keyboard-state.txt').write_text(state)
        raise AssertionError('Software keyboard closed while editing login')

def screenshot(name):
    with (out / name).open('wb') as file:
        subprocess.run(['adb', 'exec-out', 'screencap', '-p'], stdout=file, check=True)

try:
    adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1')
    adb('shell', 'am', 'force-stop', 'com.dottmedia.dotti')
    adb('shell', 'monkey', '-p', 'com.dottmedia.dotti', '-c', 'android.intent.category.LAUNCHER', '1')
    time.sleep(15)
    tap(find('text', 'Sign in'))
    tap(find('resource-id', 'login-email'))
    time.sleep(3)
    keyboard_visible()
    for part in ['keyboard', '-check', '@example.com']:
        adb('shell', 'input', 'text', part)
        time.sleep(1)
        keyboard_visible()
    email = find('resource-id', 'login-email')
    assert email.attrib['text'] == 'keyboard-check@example.com', email.attrib
    assert email.attrib.get('focused') == 'true', 'Email lost focus'
    screenshot('email-keyboard.png')
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    tap(find('resource-id', 'login-password'))
    time.sleep(3)
    keyboard_visible()
    adb('shell', 'input', 'text', 'DummyOnly123')
    time.sleep(2)
    keyboard_visible()
    password = find('resource-id', 'login-password')
    assert password.attrib.get('focused') == 'true', 'Password lost focus'
    assert len(password.attrib.get('text', '')) == len('DummyOnly123'), 'Password characters were lost'
    screenshot('password-keyboard.png')
    (out / 'result.txt').write_text('PASS: email and password accept text and retain focus with keyboard open. No login submitted.\n')
    print('PASS: Android release login keyboard remained open for both fields.')
finally:
    screenshot('final-screen.png')
    (out / 'logcat.txt').write_text(adb('logcat', '-d', '-t', '1500'))
