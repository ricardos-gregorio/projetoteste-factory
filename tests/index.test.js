import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML_URL = new URL('../index.html', import.meta.url);
const CSS_URL = new URL('../css/styles.css', import.meta.url);
const PKG_URL = new URL('../package.json', import.meta.url);

const stripBom = (s) => s.replace(/^\uFEFF/, '');
const readText = (url) => stripBom(fs.readFileSync(url, 'utf8'));

const rawHtml = fs.existsSync(HTML_URL) ? readText(HTML_URL) : '';
const rawCss = fs.existsSync(CSS_URL) ? readText(CSS_URL) : '';

const parse = (html) => new JSDOM(html).window.document;
const document = parse(rawHtml);

const WELCOME_RE = /bem[- ]vind[oa]s?|boas[- ]vindas/i;

// ---------------------------------------------------------------------------
// Verificadores reutilizáveis: aplicados à página real (caminho feliz) e a
// fixtures defeituosas (casos de erro), garantindo que os testes realmente
// detectam regressões.
// ---------------------------------------------------------------------------
const checks = {
  doctype: (html) => /^\s*<!doctype html>/i.test(stripBom(html)),
  singleWelcomeH1: (doc) => {
    const h1s = doc.querySelectorAll('h1');
    return h1s.length === 1 && WELCOME_RE.test(h1s[0].textContent);
  },
  landmarksOnce: (doc) =>
    ['header', 'nav', 'main', 'footer'].every((t) => doc.querySelectorAll(t).length === 1),
  ctaElements: (doc) =>
    [...doc.querySelectorAll('a, button')].filter((el) => /ver carros/i.test(el.textContent)),
  ctaValid: (doc) => {
    const ctas = checks.ctaElements(doc);
    return ctas.length > 0 &&
      ctas.every((el) => el.tagName !== 'A' || el.getAttribute('href') === '#destaques');
  },
  destaquesCardsValid: (doc) => {
    const section = doc.getElementById('destaques');
    if (!section) return false;
    const cards = section.querySelectorAll('.card');
    return cards.length >= 3 && [...cards].every((card) => {
      const title = card.querySelector('h2, h3');
      return Boolean(title && title.textContent.trim());
    });
  },
  brokenAnchors: (doc) =>
    [...doc.querySelectorAll('a[href^="#"]')]
      .map((a) => a.getAttribute('href'))
      .filter((href) => href !== '#')
      .filter((href) => !doc.getElementById(decodeURIComponent(href.slice(1)))),
  noScriptNoInlineStyle: (doc) =>
    doc.querySelectorAll('script').length === 0 && doc.querySelectorAll('[style]').length === 0,
  imgsHaveAlt: (doc) => [...doc.querySelectorAll('img')].every((img) => img.hasAttribute('alt')),
  footerHasCopyright: (doc) => {
    const footer = doc.querySelector('footer');
    return Boolean(footer && /©|direitos/i.test(footer.textContent));
  },
  mediaMinWidth: (css) => /@media[^{]*min-width/i.test(css),
};

const page = (body, head = '') =>
  `<!DOCTYPE html><html lang="pt-BR"><head>${head}</head><body>${body}</body></html>`;

describe('página de boas-vindas', () => {
  test('CA-1: index.html existe na raiz e começa com o doctype HTML5', () => {
    assert.ok(fs.existsSync(HTML_URL), 'index.html deve existir na raiz do repositório');
    assert.ok(checks.doctype(rawHtml), 'index.html deve começar com <!DOCTYPE html>');
  });

  test('CA-2: <html> possui lang="pt-BR"', () => {
    assert.equal(document.documentElement.getAttribute('lang'), 'pt-BR');
  });

  test('CA-3: <head> tem meta charset UTF-8 e meta viewport com width=device-width', () => {
    const charset = document.head.querySelector('meta[charset]');
    assert.ok(charset, 'meta charset ausente');
    assert.equal(charset.getAttribute('charset').toLowerCase(), 'utf-8');

    const viewport = document.head.querySelector('meta[name="viewport"]');
    assert.ok(viewport, 'meta viewport ausente');
    assert.match(viewport.getAttribute('content') ?? '', /width\s*=\s*device-width/);
  });

  test('CA-4: <title> não vazio e menciona carro(s) ou o nome do site', () => {
    const title = document.title.trim();
    assert.ok(title.length > 0, 'title vazio');
    const brandEl = document.querySelector('header .brand') ?? document.querySelector('header');
    const brand = brandEl?.textContent.trim().split(/\s+/)[0] ?? '';
    const mentionsBrand = brand.length > 0 && title.toLowerCase().includes(brand.toLowerCase());
    assert.ok(/carros?/i.test(title) || mentionsBrand, `title "${title}" não menciona carros nem a marca`);
  });

  test('CA-5: meta description não vazia e mencionando carros', () => {
    const desc = document.head.querySelector('meta[name="description"]');
    assert.ok(desc, 'meta description ausente');
    const content = (desc.getAttribute('content') ?? '').trim();
    assert.ok(content.length > 0, 'meta description vazia');
    assert.match(content, /carro/i);
  });

  test('CA-6: exatamente um h1 com mensagem de boas-vindas', () => {
    assert.equal(document.querySelectorAll('h1').length, 1);
    assert.match(document.querySelector('h1').textContent, WELCOME_RE);
  });

  test('CA-7: landmarks header, nav, main e footer presentes exatamente uma vez', () => {
    for (const tag of ['header', 'nav', 'main', 'footer']) {
      assert.equal(document.querySelectorAll(tag).length, 1, `<${tag}> deve aparecer exatamente uma vez`);
    }
    assert.ok(document.querySelector('header nav'), '<nav> deve ficar dentro do <header>');
    assert.ok(document.querySelector('main h1'), 'o <h1> deve ficar dentro do <main>');
  });

  test('CA-8: CTA "Ver carros" aponta para #destaques', () => {
    const ctas = checks.ctaElements(document);
    assert.ok(ctas.length >= 1, 'nenhum CTA "Ver carros" encontrado');
    for (const el of ctas) {
      if (el.tagName === 'A') assert.equal(el.getAttribute('href'), '#destaques');
    }
  });

  test('CA-9: #destaques possui ao menos 3 cards, cada um com título não vazio', () => {
    const section = document.getElementById('destaques');
    assert.ok(section, 'elemento #destaques ausente');
    const cards = section.querySelectorAll('.card');
    assert.ok(cards.length >= 3, `esperado ≥ 3 cards, encontrado ${cards.length}`);
    cards.forEach((card, i) => {
      const title = card.querySelector('h2, h3');
      assert.ok(title, `card ${i + 1} sem título h2/h3`);
      assert.ok(title.textContent.trim().length > 0, `card ${i + 1} com título vazio`);
    });
  });

  test('CA-10: nenhum link âncora interno quebrado', () => {
    const anchors = document.querySelectorAll('a[href^="#"]');
    assert.ok(anchors.length > 0, 'esperado ao menos um link âncora interno (nav/CTA)');
    assert.deepEqual(checks.brokenAnchors(document), []);
  });

  test('CA-10 (borda): ids da página são únicos (âncoras não ambíguas)', () => {
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dupes, []);
  });

  test('CA-11: stylesheet css/styles.css referenciada, existente e não vazia', () => {
    assert.ok(
      document.head.querySelector('link[rel="stylesheet"][href="css/styles.css"]'),
      '<link rel="stylesheet" href="css/styles.css"> ausente',
    );
    assert.ok(fs.existsSync(CSS_URL), 'css/styles.css não existe');
    assert.ok(rawCss.trim().length > 0, 'css/styles.css está vazio');
  });

  test('CA-12: CSS possui media query com min-width', () => {
    assert.ok(checks.mediaMinWidth(rawCss), 'nenhuma @media com min-width encontrada');
  });

  test('CA-13: imagens com alt, sem <script> e sem estilos inline', () => {
    assert.ok(checks.imgsHaveAlt(document), 'há <img> sem atributo alt');
    assert.equal(document.querySelectorAll('script').length, 0, 'a página não deve conter <script>');
    assert.equal(document.querySelectorAll('[style]').length, 0, 'a página não deve conter style="" inline');
  });

  test('CA-14: footer contém © ou "direitos"', () => {
    assert.ok(checks.footerHasCopyright(document));
  });

  test('CA-15: package.json configura npm test com node:test e jsdom', () => {
    const pkg = JSON.parse(readText(PKG_URL));
    assert.equal(pkg.type, 'module');
    assert.match(pkg.scripts?.test ?? '', /node --test/);
    assert.ok(pkg.devDependencies?.jsdom, 'jsdom deve ser devDependency');
  });
});

describe('casos de borda e de erro dos verificadores', () => {
  test('CA-1: doctype tolera BOM, espaços e caixa; rejeita ausência ou doctype antigo', () => {
    assert.ok(checks.doctype('\uFEFF<!DOCTYPE html><html></html>'));
    assert.ok(checks.doctype('\n  <!doctype HTML>'));
    assert.equal(checks.doctype('<html></html>'), false);
    assert.equal(checks.doctype('<!-- c --><!DOCTYPE html>'), false);
    assert.equal(checks.doctype('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">'), false);
  });

  test('CA-6: rejeita zero h1, dois h1 ou h1 sem boas-vindas; aceita variações', () => {
    assert.equal(checks.singleWelcomeH1(parse(page('<main></main>'))), false);
    assert.equal(checks.singleWelcomeH1(parse(page('<h1>Bem-vindo</h1><h1>Outro</h1>'))), false);
    assert.equal(checks.singleWelcomeH1(parse(page('<h1>Olá</h1>'))), false);
    for (const t of ['Bem-vinda!', 'BEM VINDOS', 'Boas-vindas', 'boas vindas']) {
      assert.ok(checks.singleWelcomeH1(parse(page(`<h1>${t}</h1>`))), t);
    }
  });

  test('CA-7: rejeita landmark ausente ou duplicado', () => {
    const ok = '<header><nav></nav></header><main></main><footer></footer>';
    assert.ok(checks.landmarksOnce(parse(page(ok))));
    assert.equal(checks.landmarksOnce(parse(page('<header><nav></nav></header><main></main>'))), false);
    assert.equal(checks.landmarksOnce(parse(page(ok + '<nav></nav>'))), false);
  });

  test('CA-8: rejeita CTA ausente ou apontando para outro destino; aceita <button>', () => {
    assert.equal(checks.ctaValid(parse(page('<a href="#destaques">Saiba mais</a>'))), false);
    assert.equal(checks.ctaValid(parse(page('<a href="#outro">Ver carros</a>'))), false);
    assert.equal(checks.ctaValid(parse(page('<a>Ver carros</a>'))), false);
    assert.ok(checks.ctaValid(parse(page('<a href="#destaques">VER CARROS</a>'))));
    assert.ok(checks.ctaValid(parse(page('<button type="button">Ver carros</button>'))));
  });

  test('CA-9: rejeita ausência de #destaques, menos de 3 cards, card sem título ou com título vazio', () => {
    const card = (t) => `<div class="card"><h3>${t}</h3></div>`;
    const section = (inner) => page(`<section id="destaques">${inner}</section>`);
    assert.equal(checks.destaquesCardsValid(parse(page(card('A') + card('B') + card('C')))), false);
    assert.equal(checks.destaquesCardsValid(parse(section(card('A') + card('B')))), false);
    assert.equal(checks.destaquesCardsValid(parse(section(card('A') + card('B') + card('  ')))), false);
    assert.equal(checks.destaquesCardsValid(parse(section(card('A') + card('B') + '<div class="card"><p>x</p></div>'))), false);
    assert.ok(checks.destaquesCardsValid(parse(section(card('A') + card('B') + card('C')))));
  });

  test('CA-10: detecta âncora quebrada e ignora href="#" e links externos', () => {
    const doc = parse(page(
      '<a href="#">topo</a><a href="https://x.com/#a">ext</a><a href="#sumiu">x</a>' +
      '<div id="ok"></div><a href="#ok">ok</a>',
    ));
    assert.deepEqual(checks.brokenAnchors(doc), ['#sumiu']);
  });

  test('CA-12: exige @media com min-width (max-width ou ausência falham)', () => {
    assert.ok(checks.mediaMinWidth('@media (min-width: 768px) { a {} }'));
    assert.ok(checks.mediaMinWidth('@media screen and (MIN-WIDTH:48em){}'));
    assert.equal(checks.mediaMinWidth('@media (max-width: 768px) { a {} }'), false);
    assert.equal(checks.mediaMinWidth('.x { min-width: 10px; }'), false);
    assert.equal(checks.mediaMinWidth(''), false);
  });

  test('CA-13: detecta img sem alt, <script> e style inline; aceita alt vazio', () => {
    assert.equal(checks.imgsHaveAlt(parse(page('<img src="a.png">'))), false);
    assert.ok(checks.imgsHaveAlt(parse(page('<img src="a.png" alt="">'))));
    assert.equal(checks.noScriptNoInlineStyle(parse(page('<script>1</script>'))), false);
    assert.equal(checks.noScriptNoInlineStyle(parse(page('', '<script src="x.js"></script>'))), false);
    assert.equal(checks.noScriptNoInlineStyle(parse(page('<p style="color:red">x</p>'))), false);
    assert.ok(checks.noScriptNoInlineStyle(parse(page('<p>x</p>'))));
  });

  test('CA-14: rejeita footer ausente ou sem aviso; aceita entidade &copy;', () => {
    assert.equal(checks.footerHasCopyright(parse(page('<p>© 2026</p>'))), false);
    assert.equal(checks.footerHasCopyright(parse(page('<footer>AutoVenda</footer>'))), false);
    assert.ok(checks.footerHasCopyright(parse(page('<footer>X &copy; 2026</footer>'))));
    assert.ok(checks.footerHasCopyright(parse(page('<footer>Todos os DIREITOS reservados</footer>'))));
  });
});
