import json, glob, re

en = {
    "loading": "Getting ready…",
    "unavailable": "Donations are not available right now. Please try again later.",
    "chooseIntro": "Choose how much you want to give. One payment, no subscription.",
    "amount": "Amount",
    "least": "At least {{ min }}",
    "amountRange": "Choose an amount from {{ min }} to {{ max }}.",
    "next": "Next",
    "change": "Change amount",
    "intro": "A donation of {{ price }}.",
    "pay": "Donate",
    "paying": "Paying…",
    "failed": "The payment did not go through.",
    "received": "Donation received. Thank you!",
    "another": "Make another donation",
    "listTitle": "Your donations",
    "refunded": "Refunded",
}
for f in glob.glob('frontend/public/i18n/*/support.json'):
    json.dump(en, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
for f in glob.glob('frontend/public/i18n/*/settingsShell.json'):
    d = json.load(open(f, encoding='utf-8'))
    d['support'] = 'Donations'
    json.dump(d, open(f, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)


def sub(p, a, b):
    s = open(p, encoding='utf-8').read()
    assert a in s, (p, a)
    open(p, 'w', encoding='utf-8').write(s.replace(a, b, 1))


sub('frontend/src/app/settings-shell/settings-shell.ts', "fallback: 'Support Seven Friends'", "fallback: 'Donations'")
sub('frontend/src/app/settings-home/settings-home.html', "|| 'Support Seven Friends'", "|| 'Donations'")
sub('frontend/src/app/settings-home/settings-home.ts', "{ supporter: boolean; enabled: boolean }", "{ enabled: boolean; donations: unknown[] }")
sub('frontend/src/app/settings-home/settings-home.ts', "s.enabled || s.supporter", "s.enabled || s.donations.length > 0")
