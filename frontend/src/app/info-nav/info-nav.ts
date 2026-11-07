import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** The three pages of the Info tab: who made the app, the terms of use, and the data and privacy. */
@Component({
  selector: 'app-info-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './info-nav.html',
})
export class InfoNav {}
