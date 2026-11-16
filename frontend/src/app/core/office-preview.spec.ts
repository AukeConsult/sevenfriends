import { safeLinks } from './office-preview';

describe('safeLinks', () => {
  it('keeps web and mail links (opened safely) and removes every other kind', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<a id="a" href="https://example.com/x">web</a><a id="b" href="mailto:a@b.no">mail</a><a id="c" href="javascript:alert(1)">js</a>' +
      '<a id="d" href=" JaVaScRiPt:alert(1)">js2</a><a id="e" href="data:text/html,<b>x</b>">data</a><a id="f">none</a>';
    safeLinks(host);
    const get = (id: string) => host.querySelector<HTMLAnchorElement>('#' + id)!;
    expect(get('a').getAttribute('href')).toBe('https://example.com/x');
    expect(get('a').getAttribute('rel')).toBe('noopener noreferrer');
    expect(get('a').getAttribute('target')).toBe('_blank');
    expect(get('b').getAttribute('href')).toBe('mailto:a@b.no');
    for (const id of ['c', 'd', 'e', 'f']) expect(get(id).hasAttribute('href')).toBeFalse();
  });
});
