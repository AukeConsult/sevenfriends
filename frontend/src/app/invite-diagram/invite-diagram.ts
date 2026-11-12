import { Component } from '@angular/core';

/** The picture of a friend link: you send it, the friend opens it, and a request comes back to you. No text in it, so nothing to translate. */
@Component({
  selector: 'app-invite-diagram',
  standalone: true,
  template: `<svg class="sf-share-diagram" viewBox="0 0 300 76" aria-hidden="true" focusable="false"><g transform="translate(40 0)"><circle cx="0" cy="22" r="9" fill="var(--bs-primary-bg-subtle)" stroke="currentColor" stroke-width="2"/><path d="M-16 50a16 16 0 0132 0z" fill="var(--bs-primary-bg-subtle)" stroke="currentColor" stroke-width="2"/></g><g transform="translate(260 0)"><circle cx="0" cy="22" r="9" fill="var(--bs-primary-bg-subtle)" stroke="currentColor" stroke-width="2"/><path d="M-16 50a16 16 0 0132 0z" fill="var(--bs-primary-bg-subtle)" stroke="currentColor" stroke-width="2"/></g><path d="M64 20H126M174 20H236" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M230 15l7 5-7 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><g transform="translate(150 6)"><circle cx="0" cy="14" r="13" fill="currentColor"/><g transform="translate(-8 6) scale(.67)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></g></g><path d="M252 58Q150 82 48 58" stroke="var(--sf-red)" stroke-width="2" stroke-dasharray="4 4" stroke-linecap="round" fill="none"/><path d="M56 62l-9-4 6-8" stroke="var(--sf-red)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
})
export class InviteDiagram {}
