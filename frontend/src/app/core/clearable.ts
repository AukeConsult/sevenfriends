import { AfterViewChecked, AfterViewInit, Directive, ElementRef, OnDestroy, inject } from '@angular/core';

/**
 * Puts a small "×" in a text field that can be empty: it shows when there is something to clear, and clears the field
 * (the field's own `input` event runs, so the page sees the empty value). Use `appClear` on optional text fields only.
 * In a Bootstrap `input-group` the button is a part of the group (after the field); elsewhere it sits inside the field.
 */
@Directive({ selector: 'input[appClear], textarea[appClear]' })
export class Clearable implements AfterViewInit, AfterViewChecked, OnDestroy {
  private readonly field = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef).nativeElement;
  private button: HTMLButtonElement | null = null;
  private wrapper: HTMLElement | null = null;

  ngAfterViewInit(): void {
    const field = this.field;
    const parent = field.parentElement;
    if (!parent) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Clear';
    button.setAttribute('aria-label', 'Clear');
    button.textContent = '×';
    button.addEventListener('mousedown', (event) => event.preventDefault()); // the field keeps the focus
    button.addEventListener('click', () => {
      field.value = '';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.focus();
    });

    if (parent.classList.contains('input-group')) {
      button.className = 'btn btn-outline-secondary sf-clear sf-clear-group';
      field.after(button);
    } else {
      button.className = 'sf-clear';
      const wrapper = document.createElement('span');
      wrapper.className = field instanceof HTMLTextAreaElement ? 'sf-clearable sf-clearable-area' : 'sf-clearable';
      parent.insertBefore(wrapper, field);
      wrapper.append(field, button);
      this.wrapper = wrapper;
    }
    this.button = button;
    this.sync();
  }

  /** The value changes by typing and by the page: look at it after every change detection (when the page has set its values). */
  ngAfterViewChecked(): void {
    this.sync();
  }

  private sync(): void {
    if (this.button) this.button.hidden = this.field.value === '' || this.field.disabled || this.field.readOnly;
  }

  ngOnDestroy(): void {
    this.button?.remove();
    this.wrapper?.remove();
  }
}
