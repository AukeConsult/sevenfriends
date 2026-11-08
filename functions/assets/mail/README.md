# Email templates

`invite.html` sets how the **invitation email** looks (the HTML version). The plain-text version, the subject and
the sign-up link come from the settings (`functions/.env`: `INVITE_EMAIL_TEXT`, `INVITE_EMAIL_SUBJECT`, `APP_URL`).
Mail programs that cannot show HTML show the text version.

## Edit it

Change colours, fonts, wording and layout as you like. Mail programs ignore most CSS, so keep the **styles inline** and
the layout in **tables**, like the file does. Images need an address on the internet (nothing is attached).

## Places that are filled in

Written as `{name}`. Every value is made safe for HTML for you (a message can never add markup).

| Place       | What it becomes                                              |
| ----------- | ------------------------------------------------------------ |
| `{fromName}`| the name of the person who invites                           |
| `{to}`      | the email address that is invited                            |
| `{message}` | their message, in quotes                                     |
| `{appUrl}`  | the link to Seven Friends (`APP_URL` in the settings)        |
| `{appName}` | the name of the app of the circle: Seven Friends, Buddies, Work or Family |
| `{inviteUrl}` | the link to the welcome page of that circle, with the address invited |
| `{subject}` | the subject line (`INVITE_EMAIL_SUBJECT`)                    |

**Only with a message:** put the part that should disappear when the sender wrote no message between an HTML comment
that says `message` and one that says `/message` (see how the file does it around the quote box).

The first HTML comment of the file (the note at the top) is not sent.

## See the result

    npm --prefix functions run mail:preview

writes `preview.html` and `preview-without-message.html` here; open them in a browser. (They are not committed.)

## Another file

`INVITE_EMAIL_TEMPLATE` in the settings points to the file (default `assets/mail/invite.html`, relative to the `functions`
folder). Delete the file, or point to one that does not exist, and the email is sent as text only.
