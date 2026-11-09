import { Pipe, PipeTransform } from '@angular/core';
import { activeLang } from './i18n';

/** The date formats used in the templates, as `Intl` options, so months and weekdays follow the language of the app (Angular's `date` pipe is English only). */
const FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  'd MMM, HH:mm': { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false },
  'd MMM yyyy': { day: 'numeric', month: 'short', year: 'numeric' },
  'd MMM yyyy HH:mm:ss': { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
  mediumDate: { dateStyle: 'medium' },
  short: { dateStyle: 'short', timeStyle: 'short' },
};

/** `{{ value | appDate: 'd MMM yyyy' }}`: the same formats as Angular's `date` pipe that the app uses, in the language of the app. */
@Pipe({ name: 'appDate' })
export class AppDatePipe implements PipeTransform {
  transform(value: Date | string | number | null | undefined, format: string = 'mediumDate'): string {
    if (value === null || value === undefined || value === '') return '';
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(activeLang(), FORMATS[format] ?? FORMATS['mediumDate']).format(date);
  }
}
