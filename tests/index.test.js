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
      .filter((href) => {
        let id = href.slice(1);
        try { id = decodeURIComponent(id); } catch { /* fragmento malformado: usa o valor bruto */ }
        return !doc.getElementById(id);
      }),
  noScriptNoInlineStyle: (doc) =>
    doc.querySelectorAll('script').length === 0 && doc.querySelectorAll('[style]').length === 0,
  imgsHaveAlt: (doc) => [...doc.querySelectorAll('img')].every((img) => img.hasAttribute('alt')),
  footerHasCopyright: (doc) => {
    const footer = doc.querySelector('footer');
    return Boolean(footer && /©|direitos/i.test(footer.textContent));
  },
  // Remove comentários antes do match para evitar falso positivo com @media comentada.
  mediaMinWidth: (css) => /@media[^{]*min-width/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')),
  langPtBR: (doc) => doc.documentElement.getAttribute('lang') === 'pt-BR',
  charsetAndViewport: (doc) => {
    const charset = doc.head.querySelector('meta[charset]');
    const viewport = doc.head.querySelector('meta[name="viewport"]');
    return Boolean(charset && charset.getAttribute('charset').trim().toLowerCase() === 'utf-8' &&
      viewport && /width\s*=\s*device-width/i.test(viewport.getAttribute('content') ?? ''));
  },
  // Marca aceita em header .brand, .app-header .brand, .brand-link ou .brand-text.
  brandText: (doc) => {
    const el = doc.querySelector(
      'header .brand, .app-header .brand, .app-header .brand-link, .app-sidebar .brand-link, .brand-text',
    );
    return (el?.textContent ?? '').trim();
  },
  titleValid: (doc) => {
    const title = (doc.querySelector('head > title')?.textContent ?? '').trim();
    if (!title) return false;
    const brand = checks.brandText(doc);
    return /carros?/i.test(title) ||
      (brand.length > 0 && title.toLowerCase().includes(brand.toLowerCase()));
  },
  descriptionValid: (doc) => {
    const meta = doc.head.querySelector('meta[name="description"]');
    const content = (meta?.getAttribute('content') ?? '').trim();
    return content.length > 0 && /carro/i.test(content);
  },
  h1InMain: (doc) => {
    const h1 = doc.querySelector('h1');
    return Boolean(h1 && h1.closest('main'));
  },
  landmarksNested: (doc) => Boolean(doc.querySelector('header nav') && doc.querySelector('main h1')),
  internalAnchors: (doc) =>
    [...doc.querySelectorAll('a[href^="#"]')].filter((a) => a.getAttribute('href') !== '#'),
  duplicateIds: (doc) => {
    const ids = [...doc.querySelectorAll('[id]')].map((el) => el.id);
    return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  },
  stylesheetLinked: (doc) =>
    Boolean(doc.head.querySelector('link[rel~="stylesheet"][href="css/styles.css"]')),
  navLinksValid: (doc) => {
    const links = [...doc.querySelectorAll('header nav a')]
      .map((a) => [a.textContent.trim(), a.getAttribute('href')]);
    return JSON.stringify(links) ===
      JSON.stringify([['Início', '#inicio'], ['Destaques', '#destaques'], ['Contato', '#contato']]);
  },
  footerIsContato: (doc) => doc.querySelector('footer')?.id === 'contato',
  requiredCardTitles: (doc) => {
    const titles = [...doc.querySelectorAll('#destaques .card')]
      .map((c) => (c.querySelector('h2, h3')?.textContent ?? '').trim());
    return ['Carros novos', 'Seminovos', 'Financiamento'].every((t) => titles.includes(t));
  },
  packageConfig: (pkg) =>
    pkg?.type === 'module' &&
    /\bnode\s+--test\b/.test(pkg?.scripts?.test ?? '') &&
    Boolean(pkg?.devDependencies?.jsdom) &&
    !pkg?.dependencies?.jsdom,
  // CA-16: shell AdminLTE — .app-wrapper sob o body (filho direto ou único wrapper).
  hasAppWrapper: (doc) => {
    const wrappers = [...doc.body?.querySelectorAll('.app-wrapper') ?? []];
    if (wrappers.length === 0) return false;
    return wrappers.some((el) => el.parentElement === doc.body);
  },
  // CA-17: .app-header é ou contém o <header> e envolve marca + único <nav>.
  hasAppHeader: (doc) => {
    const appHeader = doc.querySelector('.app-header');
    if (!appHeader) return false;
    const header = doc.querySelector('header');
    if (!header) return false;
    const headerOk = appHeader === header || appHeader.contains(header) || header.contains(appHeader);
    if (!headerOk) return false;
    const brandOk = Boolean(
      appHeader.querySelector('.brand, .brand-link, .brand-text') ||
      header.querySelector('.brand, .brand-link, .brand-text'),
    );
    const nav = doc.querySelector('nav');
    return brandOk && Boolean(nav) && (appHeader.contains(nav) || header.contains(nav));
  },
  // CA-18: .app-sidebar com links Início/Destaques/Contato; sem segundo <nav>.
  hasAppSidebar: (doc) => {
    const sidebar = doc.querySelector('.app-sidebar');
    if (!sidebar) return false;
    if (sidebar.querySelector('nav') || doc.querySelectorAll('nav').length !== 1) return false;
    const expected = [
      ['Início', '#inicio'],
      ['Destaques', '#destaques'],
      ['Contato', '#contato'],
    ];
    const links = [...sidebar.querySelectorAll('a[href^="#"]')].map((a) => [
      a.textContent.trim(),
      a.getAttribute('href'),
    ]);
    return expected.every(([text, href]) =>
      links.some(([t, h]) => t === text && h === href));
  },
  // CA-19: .app-main (e .app-content descendente ou o próprio) com #inicio e #destaques.
  hasAppMain: (doc) => {
    const main = doc.querySelector('.app-main');
    if (!main) return false;
    const contentRoot = main.querySelector('.app-content') ?? main;
    return Boolean(
      contentRoot.querySelector('#inicio') && contentRoot.querySelector('#destaques'),
    );
  },
  // CA-20: CDN HTTPS Bootstrap 5 + AdminLTE 4, além de css/styles.css.
  cdnStylesheets: (doc) => {
    const hrefs = [...doc.head.querySelectorAll('link[rel~="stylesheet"]')]
      .map((l) => l.getAttribute('href') ?? '');
    const https = hrefs.filter((h) => /^https:\/\//i.test(h));
    const hasBootstrap = https.some((h) => /bootstrap/i.test(h));
    const hasAdminLte = https.some((h) => /adminlte/i.test(h));
    const hasLocal = hrefs.some((h) => h === 'css/styles.css');
    return hasBootstrap && hasAdminLte && hasLocal;
  },
  // CA-21: cada #destaques .card tem .card-body (título h2/h3 dentro do card).
  cardsHaveBody: (doc) => {
    const section = doc.getElementById('destaques');
    if (!section) return false;
    const cards = [...section.querySelectorAll('.card')];
    if (cards.length < 3) return false;
    return cards.every((card) => {
      const body = card.querySelector('.card-body');
      const title = card.querySelector('h2, h3');
      return Boolean(body && title && title.textContent.trim() && card.contains(title));
    });
  },
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
    assert.ok(checks.langPtBR(document));
  });

  test('CA-3: <head> tem meta charset UTF-8 e meta viewport com width=device-width', () => {
    const charset = document.head.querySelector('meta[charset]');
    assert.ok(charset, 'meta charset ausente');
    assert.equal(charset.getAttribute('charset').toLowerCase(), 'utf-8');

    const viewport = document.head.querySelector('meta[name="viewport"]');
    assert.ok(viewport, 'meta viewport ausente');
    assert.match(viewport.getAttribute('content') ?? '', /width\s*=\s*device-width/);
    assert.ok(checks.charsetAndViewport(document));
  });

  test('CA-4: <title> não vazio e menciona carro(s) ou o nome do site', () => {
    const title = document.title.trim();
    assert.ok(title.length > 0, 'title vazio');
    assert.ok(checks.brandText(document), 'marca ausente (header .brand / .brand-link / .brand-text)');
    assert.ok(checks.titleValid(document), `title "${title}" não menciona carros nem a marca`);
  });

  test('CA-5: meta description não vazia e mencionando carros', () => {
    const desc = document.head.querySelector('meta[name="description"]');
    assert.ok(desc, 'meta description ausente');
    const content = (desc.getAttribute('content') ?? '').trim();
    assert.ok(content.length > 0, 'meta description vazia');
    assert.match(content, /carro/i);
    assert.ok(checks.descriptionValid(document));
  });

  test('CA-6: exatamente um h1, dentro de <main>, com mensagem de boas-vindas', () => {
    assert.equal(document.querySelectorAll('h1').length, 1);
    assert.match(document.querySelector('h1').textContent, WELCOME_RE);
    assert.ok(document.querySelector('main h1'), 'o <h1> deve ficar dentro do <main>');
    assert.ok(checks.singleWelcomeH1(document));
    assert.ok(checks.h1InMain(document));
  });

  test('CA-7: landmarks header, nav, main e footer presentes exatamente uma vez', () => {
    for (const tag of ['header', 'nav', 'main', 'footer']) {
      assert.equal(document.querySelectorAll(tag).length, 1, `<${tag}> deve aparecer exatamente uma vez`);
    }
    assert.ok(document.querySelector('header nav'), '<nav> deve ficar dentro do <header>');
    assert.ok(document.querySelector('main h1'), 'o <h1> deve ficar dentro do <main>');
    assert.ok(checks.landmarksOnce(document) && checks.landmarksNested(document));
  });

  test('CA-8: CTA "Ver carros" aponta para #destaques', () => {
    const ctas = checks.ctaElements(document);
    assert.ok(ctas.length >= 1, 'nenhum CTA "Ver carros" encontrado');
    for (const el of ctas) {
      if (el.tagName === 'A') assert.equal(el.getAttribute('href'), '#destaques');
    }
    assert.ok(checks.ctaValid(document));
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
    assert.ok(checks.destaquesCardsValid(document));
    assert.ok(checks.requiredCardTitles(document), 'cards Carros novos/Seminovos/Financiamento ausentes');
  });

  test('CA-10: nenhum link âncora interno quebrado', () => {
    const anchors = document.querySelectorAll('a[href^="#"]');
    assert.ok(anchors.length > 0, 'esperado ao menos um link âncora interno (nav/CTA)');
    assert.ok(checks.internalAnchors(document).length > 0, 'esperado ao menos um link âncora além de href="#"');
    assert.deepEqual(checks.brokenAnchors(document), []);
  });

  test('CA-10 (borda): ids da página são únicos (âncoras não ambíguas)', () => {
    assert.deepEqual(checks.duplicateIds(document), []);
  });

  test('CA-10: navegação Início/Destaques/Contato, cards e rodapé id="contato" conforme a spec', () => {
    const navTexts = [...document.querySelectorAll('header nav a')].map((a) => a.textContent.trim());
    assert.deepEqual(navTexts, ['Início', 'Destaques', 'Contato']);
    const cardTitles = [...document.querySelectorAll('#destaques .card')]
      .map((c) => (c.querySelector('h2, h3')?.textContent ?? '').trim());
    for (const t of ['Carros novos', 'Seminovos', 'Financiamento']) {
      assert.ok(cardTitles.includes(t), `card "${t}" ausente`);
    }
    assert.equal(document.querySelector('footer')?.id, 'contato', 'o rodapé deve ter id="contato"');
    assert.ok(checks.navLinksValid(document), 'nav deve ter Início/Destaques/Contato com hrefs corretos');
    assert.ok(checks.footerIsContato(document));
  });

  test('CA-11: stylesheet css/styles.css referenciada, existente e não vazia', () => {
    assert.ok(
      document.head.querySelector('link[rel="stylesheet"][href="css/styles.css"]'),
      '<link rel="stylesheet" href="css/styles.css"> ausente',
    );
    assert.ok(checks.stylesheetLinked(document));
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
    assert.ok(checks.noScriptNoInlineStyle(document));
  });

  test('CA-14: footer contém © ou "direitos"', () => {
    assert.ok(checks.footerHasCopyright(document));
  });

  test('CA-15: package.json configura npm test com node:test e jsdom', () => {
    const pkg = JSON.parse(readText(PKG_URL));
    assert.equal(pkg.type, 'module');
    assert.match(pkg.scripts?.test ?? '', /node --test/);
    assert.ok(pkg.devDependencies?.jsdom, 'jsdom deve ser devDependency');
    assert.ok(!pkg.dependencies?.jsdom, 'jsdom não deve estar em dependencies');
    assert.ok(checks.packageConfig(pkg));
  });

  test('CA-16: existe .app-wrapper como contêiner de layout sob o <body>', () => {
    const wrapper = document.querySelector('.app-wrapper');
    assert.ok(wrapper, '.app-wrapper ausente');
    assert.equal(wrapper.parentElement, document.body, '.app-wrapper deve ser filho direto de <body>');
    assert.ok(checks.hasAppWrapper(document));
  });

  test('CA-17: .app-header envolve a marca e o único <nav> (é ou contém o <header>)', () => {
    const appHeader = document.querySelector('.app-header');
    assert.ok(appHeader, '.app-header ausente');
    assert.ok(
      appHeader.matches('header') || appHeader.querySelector('header') || document.querySelector('header .app-header'),
      '.app-header deve ser ou estar relacionado ao <header>',
    );
    assert.ok(
      appHeader.querySelector('.brand, .brand-link, .brand-text') ||
        document.querySelector('header .brand, header .brand-link, header .brand-text'),
      'marca ausente no header AdminLTE',
    );
    assert.ok(document.querySelector('.app-header nav, header.app-header nav, header nav'),
      '<nav> deve ficar sob o header/navbar');
    assert.ok(checks.hasAppHeader(document));
  });

  test('CA-18: .app-sidebar com links Início/Destaques/Contato e sem segundo <nav>', () => {
    const sidebar = document.querySelector('.app-sidebar');
    assert.ok(sidebar, '.app-sidebar ausente');
    assert.equal(sidebar.querySelectorAll('nav').length, 0, 'sidebar não deve introduzir <nav>');
    assert.equal(document.querySelectorAll('nav').length, 1, 'deve haver exatamente um <nav> na página');
    const texts = [...sidebar.querySelectorAll('a')].map((a) => a.textContent.trim());
    for (const t of ['Início', 'Destaques', 'Contato']) {
      assert.ok(texts.includes(t), `link "${t}" ausente na sidebar`);
    }
    assert.ok(checks.hasAppSidebar(document));
  });

  test('CA-19: .app-main (com .app-content) contém #inicio e #destaques', () => {
    const main = document.querySelector('.app-main');
    assert.ok(main, '.app-main ausente');
    const content = main.querySelector('.app-content') ?? main;
    assert.ok(content.querySelector('#inicio'), '#inicio deve estar sob .app-main/.app-content');
    assert.ok(content.querySelector('#destaques'), '#destaques deve estar sob .app-main/.app-content');
    assert.ok(checks.hasAppMain(document));
  });

  test('CA-20: head referencia CDN HTTPS de Bootstrap e AdminLTE além de css/styles.css', () => {
    const hrefs = [...document.head.querySelectorAll('link[rel~="stylesheet"]')]
      .map((l) => l.getAttribute('href') ?? '');
    assert.ok(hrefs.some((h) => /^https:\/\//i.test(h) && /bootstrap/i.test(h)),
      'folha Bootstrap via CDN HTTPS ausente');
    assert.ok(hrefs.some((h) => /^https:\/\//i.test(h) && /adminlte/i.test(h)),
      'folha AdminLTE via CDN HTTPS ausente');
    assert.ok(hrefs.includes('css/styles.css'), 'css/styles.css ausente');
    assert.ok(checks.cdnStylesheets(document));
  });

  test('CA-21: cada card em #destaques tem .card-body e título h2/h3', () => {
    const cards = document.querySelectorAll('#destaques .card');
    assert.ok(cards.length >= 3, `esperado ≥ 3 cards, encontrado ${cards.length}`);
    cards.forEach((card, i) => {
      assert.ok(card.querySelector('.card-body'), `card ${i + 1} sem .card-body`);
      const title = card.querySelector('h2, h3');
      assert.ok(title && title.textContent.trim(), `card ${i + 1} sem título h2/h3`);
    });
    assert.ok(checks.cardsHaveBody(document));
  });
});

describe('casos de borda e de erro dos verificadores', () => {
  test('CA-2: rejeita lang ausente ou diferente de pt-BR', () => {
    assert.ok(checks.langPtBR(parse(page(''))));
    assert.equal(checks.langPtBR(parse('<!DOCTYPE html><html><body></body></html>')), false);
    assert.equal(checks.langPtBR(parse('<!DOCTYPE html><html lang="en"><body></body></html>')), false);
    assert.equal(checks.langPtBR(parse('<!DOCTYPE html><html lang="pt"><body></body></html>')), false);
    assert.equal(checks.langPtBR(parse('<!DOCTYPE html><html lang=""><body></body></html>')), false);
  });

  test('CA-3: rejeita charset ausente/não UTF-8 e viewport ausente ou sem width=device-width', () => {
    const vp = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    assert.ok(checks.charsetAndViewport(parse(page('', '<meta charset="UTF-8">' + vp))));
    assert.ok(checks.charsetAndViewport(parse(page('', '<meta charset="utf-8">' + vp))));
    assert.equal(checks.charsetAndViewport(parse(page('', vp))), false);
    assert.equal(checks.charsetAndViewport(parse(page('', '<meta charset="ISO-8859-1">' + vp))), false);
    assert.equal(checks.charsetAndViewport(parse(page('', '<meta charset="UTF-8">'))), false);
    assert.equal(checks.charsetAndViewport(parse(page('',
      '<meta charset="UTF-8"><meta name="viewport" content="initial-scale=1">'))), false);
  });

  test('CA-4: rejeita title ausente, vazio ou sem carros/marca; aceita a marca do cabeçalho', () => {
    const header = '<header><a class="brand">MinhaLoja</a></header>';
    assert.equal(checks.titleValid(parse(page(header))), false);
    assert.equal(checks.titleValid(parse(page(header, '<title>   </title>'))), false);
    assert.equal(checks.titleValid(parse(page(header, '<title>Página inicial</title>'))), false);
    assert.equal(checks.titleValid(parse(page('', '<title>Página inicial</title>'))), false);
    assert.ok(checks.titleValid(parse(page(header, '<title>MinhaLoja - Início</title>'))));
    assert.ok(checks.titleValid(parse(page('', '<title>Venda de Carro</title>'))));
    assert.ok(checks.titleValid(parse(page(
      '<header class="app-header"><a class="brand-link"><span class="brand-text">AutoX</span></a></header>',
      '<title>AutoX</title>',
    ))));
  });

  test('CA-5: rejeita description ausente, vazia ou sem "carro"', () => {
    const meta = (c) => `<meta name="description" content="${c}">`;
    assert.equal(checks.descriptionValid(parse(page(''))), false);
    assert.equal(checks.descriptionValid(parse(page('', meta('  ')))), false);
    assert.equal(checks.descriptionValid(parse(page('', meta('Loja de motos')))), false);
    assert.equal(checks.descriptionValid(parse(page('', '<meta name="description">'))), false);
    assert.ok(checks.descriptionValid(parse(page('', meta('Os melhores CARROS')))));
  });

  test('CA-1: doctype tolera BOM, espaços e caixa; rejeita ausência ou doctype antigo', () => {
    assert.ok(checks.doctype('\uFEFF<!DOCTYPE html><html></html>'));
    assert.ok(checks.doctype('\n  <!doctype HTML>'));
    assert.equal(checks.doctype('<html></html>'), false);
    assert.equal(checks.doctype('<!-- c --><!DOCTYPE html>'), false);
    assert.equal(checks.doctype('texto<!DOCTYPE html>'), false);
    assert.equal(checks.doctype(''), false);
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

  test('CA-6: rejeita h1 de boas-vindas fora do <main> ou ausente', () => {
    assert.ok(checks.h1InMain(parse(page('<main><section><h1>Bem-vindo</h1></section></main>'))));
    assert.equal(checks.h1InMain(parse(page('<header><h1>Bem-vindo</h1></header><main></main>'))), false);
    assert.equal(checks.h1InMain(parse(page('<h1>Bem-vindo</h1><main><p>x</p></main>'))), false);
    assert.equal(checks.h1InMain(parse(page('<main><h2>Bem-vindo</h2></main>'))), false);
    assert.equal(checks.h1InMain(parse(page(''))), false);
  });

  test('CA-7: rejeita landmark ausente ou duplicado', () => {
    const ok = '<header><nav></nav></header><main></main><footer></footer>';
    assert.ok(checks.landmarksOnce(parse(page(ok))));
    assert.equal(checks.landmarksOnce(parse(page('<header><nav></nav></header><main></main>'))), false);
    assert.equal(checks.landmarksOnce(parse(page(ok + '<nav></nav>'))), false);
    assert.equal(checks.landmarksOnce(parse(page(ok + '<footer></footer>'))), false);
  });

  test('CA-7: rejeita nav fora do header ou h1 fora do main', () => {
    assert.ok(checks.landmarksNested(parse(page('<header><nav></nav></header><main><h1>Oi</h1></main>'))));
    assert.equal(checks.landmarksNested(parse(page('<header></header><nav></nav><main><h1>Oi</h1></main>'))), false);
    assert.equal(checks.landmarksNested(parse(page('<header><nav></nav><h1>Oi</h1></header><main></main>'))), false);
  });

  test('CA-8: rejeita CTA ausente ou apontando para outro destino; aceita <button>', () => {
    assert.equal(checks.ctaValid(parse(page('<a href="#destaques">Saiba mais</a>'))), false);
    assert.equal(checks.ctaValid(parse(page('<a href="#outro">Ver carros</a>'))), false);
    assert.equal(checks.ctaValid(parse(page('<a>Ver carros</a>'))), false);
    assert.ok(checks.ctaValid(parse(page('<a href="#destaques">VER CARROS</a>'))));
    assert.ok(checks.ctaValid(parse(page('<button type="button">Ver carros</button>'))));
    assert.equal(checks.ctaValid(parse(page(
      '<a href="#destaques">Ver carros</a><a href="/catalogo">Ver carros</a>'))), false);
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

  test('CA-10: âncoras com fragmento percent-encoded são decodificadas; fragmento malformado não quebra', () => {
    const doc = parse(page(
      '<section id="início"></section><a href="#in%C3%ADcio">ok</a>' +
      '<a href="#%E0%A4%A">malformado</a><a href="#in%C3%ADcio-x">x</a>',
    ));
    assert.deepEqual(checks.brokenAnchors(doc), ['#%E0%A4%A', '#in%C3%ADcio-x']);
    const docMalformadoExistente = parse(page('<div id="%E0%A4%A"></div><a href="#%E0%A4%A">x</a>'));
    assert.deepEqual(checks.brokenAnchors(docMalformadoExistente), []);
  });

  test('CA-10: exige ao menos uma âncora interna real e detecta ids duplicados', () => {
    assert.equal(checks.internalAnchors(parse(page('<a href="#">topo</a><a href="/x">x</a>'))).length, 0);
    assert.equal(checks.internalAnchors(parse(page('<div id="a"></div><a href="#a">a</a>'))).length, 1);
    assert.deepEqual(checks.duplicateIds(parse(page('<div id="a"></div><p id="a"></p><p id="b"></p>'))), ['a']);
    assert.deepEqual(checks.duplicateIds(parse(page('<div id="a"></div><p id="b"></p>'))), []);
  });

  test('CA-10: navegação exige Início, Destaques e Contato nessa ordem e rodapé com id="contato"', () => {
    const li = (t, h) => `<a href="${h}">${t}</a>`;
    const nav = (inner) => page(`<header><nav>${inner}</nav></header>`);
    const ok = li('Início', '#inicio') + li('Destaques', '#destaques') + li('Contato', '#contato');
    assert.ok(checks.navLinksValid(parse(nav(ok))));
    assert.equal(checks.navLinksValid(parse(nav(
      li('Destaques', '#destaques') + li('Início', '#inicio') + li('Contato', '#contato')))), false);
    assert.equal(checks.navLinksValid(parse(nav(li('Início', '#inicio') + li('Destaques', '#destaques')))), false);
    assert.equal(checks.navLinksValid(parse(nav(ok + li('Blog', '#blog')))), false);
    assert.equal(checks.navLinksValid(parse(nav(
      li('Início', '#inicio') + li('Destaques', '#outro') + li('Contato', '#contato')))), false);
    assert.equal(checks.navLinksValid(parse(page(`<nav>${ok}</nav>`))), false);
    assert.ok(checks.footerIsContato(parse(page('<footer id="contato"></footer>'))));
    assert.equal(checks.footerIsContato(parse(page('<footer></footer><div id="contato"></div>'))), false);
    assert.equal(checks.footerIsContato(parse(page(''))), false);
  });

  test('CA-9: exige os títulos Carros novos, Seminovos e Financiamento', () => {
    const card = (t) => `<div class="card"><h3>${t}</h3></div>`;
    const section = (inner) => page(`<section id="destaques">${inner}</section>`);
    assert.ok(checks.requiredCardTitles(parse(section(
      card('Carros novos') + card('Seminovos') + card('Financiamento')))));
    assert.equal(checks.requiredCardTitles(parse(section(
      card('Carros novos') + card('Seminovos') + card('Consórcio')))), false);
    assert.equal(checks.requiredCardTitles(parse(page(
      card('Carros novos') + card('Seminovos') + card('Financiamento')))), false);
    assert.equal(checks.requiredCardTitles(parse(section(
      card('Carros novos') + card('Seminovos') + '<div class="card"><p>Financiamento</p></div>'))), false);
  });

  test('CA-11: rejeita stylesheet ausente, com outro href ou rel diferente', () => {
    assert.ok(checks.stylesheetLinked(parse(page('', '<link rel="stylesheet" href="css/styles.css">'))));
    assert.equal(checks.stylesheetLinked(parse(page(''))), false);
    assert.equal(checks.stylesheetLinked(parse(page('', '<link rel="stylesheet" href="styles.css">'))), false);
    assert.equal(checks.stylesheetLinked(parse(page('', '<link rel="preload" href="css/styles.css">'))), false);
  });

  test('CA-12: exige @media com min-width (max-width ou ausência falham)', () => {
    assert.ok(checks.mediaMinWidth('@media (min-width: 768px) { a {} }'));
    assert.ok(checks.mediaMinWidth('@media screen and (MIN-WIDTH:48em){}'));
    assert.equal(checks.mediaMinWidth('@media (max-width: 768px) { a {} }'), false);
    assert.equal(checks.mediaMinWidth('.x { min-width: 10px; }'), false);
    assert.equal(checks.mediaMinWidth(''), false);
    assert.equal(checks.mediaMinWidth('@media print { .x { min-width: 10px; } }'), false);
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
    assert.ok(checks.footerHasCopyright(parse(page('<footer>© 2026 AutoVenda</footer>'))));
    assert.equal(checks.footerHasCopyright(parse(page('<footer>  </footer>'))), false);
  });

  test('CA-11/CA-12/CA-13 (borda): stylesheet fora do head, min-width só em comentário e alt sem valor', () => {
    assert.equal(checks.stylesheetLinked(parse(page('<link rel="stylesheet" href="css/styles.css">'))), false);
    assert.ok(checks.stylesheetLinked(parse(page('', '<link rel="alternate stylesheet" href="css/styles.css">'))));
    assert.equal(checks.mediaMinWidth('/* min-width */ .x { color: red; }'), false);
    assert.equal(checks.mediaMinWidth('@media (max-width: 600px) { .x { min-width: 1px; } }'), false);
    assert.ok(checks.imgsHaveAlt(parse(page('<img src="a.png" alt>'))));
    assert.equal(checks.imgsHaveAlt(parse(page('<img src="a.png" alt="ok"><img src="b.png">'))), false);
    assert.ok(checks.imgsHaveAlt(parse(page('<p>sem imagens</p>'))));
  });

  test('CA-12 (borda): @media min-width comentada não conta; comentário não esconde @media válida', () => {
    assert.equal(checks.mediaMinWidth('/* @media (min-width: 768px) { a {} } */ .x { color: red; }'), false);
    assert.equal(checks.mediaMinWidth('/*\n@media (min-width: 768px) {\n}\n*/\n@media print { a {} }'), false);
    assert.equal(checks.mediaMinWidth('@media /* tela */ (max-width: 600px) { a {} } /* min-width */'), false);
    assert.ok(checks.mediaMinWidth('/* desktop */\n@media (min-width: 768px) { a {} }'));
    assert.ok(checks.mediaMinWidth('@media /* tela */ screen and (min-width: 48em) { a {} }'));
    assert.ok(checks.mediaMinWidth('@media (max-width: 1200px) and (min-width: 768px) { a {} }'));
  });

  test('CA-6/CA-8 (borda): CTA só conta em a/button e h1 vazio é rejeitado', () => {
    // O CTA não deve ser confundido com o título dos cards: só a/button contam.
    assert.equal(checks.ctaValid(parse(page('<h3>Ver carros</h3>'))), false);
    assert.equal(checks.ctaValid(parse(page('<span>Ver carros</span><a href="#destaques">x</a>'))), false);
    // h1 vazio ou com só espaços não satisfaz boas-vindas.
    assert.equal(checks.singleWelcomeH1(parse(page('<main><h1>   </h1></main>'))), false);
  });

  test('CA-15: rejeita package.json sem type module, sem node --test ou sem jsdom em devDependencies', () => {
    const ok = {
      type: 'module',
      scripts: { test: 'node --test "tests/**/*.test.js"' },
      devDependencies: { jsdom: '^26.1.0' },
    };
    assert.ok(checks.packageConfig(ok));
    assert.equal(checks.packageConfig({ ...ok, type: 'commonjs' }), false);
    assert.equal(checks.packageConfig({ ...ok, scripts: { test: 'jest' } }), false);
    assert.equal(checks.packageConfig({ ...ok, scripts: {} }), false);
    assert.equal(checks.packageConfig({ ...ok, devDependencies: {} }), false);
    assert.equal(checks.packageConfig({ ...ok, dependencies: { jsdom: '^26.1.0' }, devDependencies: undefined }), false);
    assert.equal(checks.packageConfig({ ...ok, dependencies: { jsdom: '^26.1.0' } }), false);
    assert.equal(checks.packageConfig(undefined), false);
  });

  test('CA-16: rejeita ausência de .app-wrapper ou wrapper fora do body', () => {
    assert.equal(checks.hasAppWrapper(parse(page('<main></main>'))), false);
    assert.equal(checks.hasAppWrapper(parse(page('<div class="wrapper"></div>'))), false);
    assert.ok(checks.hasAppWrapper(parse(page('<div class="app-wrapper"><main></main></div>'))));
    // wrapper aninhado sem ser filho direto de body falha
    assert.equal(checks.hasAppWrapper(parse(page(
      '<div><div class="app-wrapper"></div></div>'))), false);
  });

  test('CA-17: rejeita .app-header ausente, sem marca ou sem nav no header', () => {
    const ok = '<header class="app-header"><a class="brand">X</a><nav></nav></header>';
    assert.ok(checks.hasAppHeader(parse(page(ok))));
    assert.equal(checks.hasAppHeader(parse(page('<header><a class="brand">X</a><nav></nav></header>'))), false);
    assert.equal(checks.hasAppHeader(parse(page(
      '<header class="app-header"><nav></nav></header>'))), false);
    assert.equal(checks.hasAppHeader(parse(page(
      '<header class="app-header"><a class="brand">X</a></header><nav></nav>'))), false);
    assert.equal(checks.hasAppHeader(parse(page(
      '<div class="app-header"><a class="brand">X</a><nav></nav></div>'))), false);
  });

  test('CA-18: rejeita sidebar ausente, links incompletos ou <nav> na sidebar', () => {
    const links =
      '<a href="#inicio">Início</a><a href="#destaques">Destaques</a><a href="#contato">Contato</a>';
    const shell = (sideInner) => page(
      `<header><nav><a href="#inicio">Início</a></nav></header>` +
      `<aside class="app-sidebar">${sideInner}</aside>`,
    );
    assert.ok(checks.hasAppSidebar(parse(shell(`<ul>${links}</ul>`))));
    assert.equal(checks.hasAppSidebar(parse(page('<aside></aside>'))), false);
    assert.equal(checks.hasAppSidebar(parse(shell('<a href="#inicio">Início</a>'))), false);
    // <nav> na sidebar viola CA-7 / CA-18
    assert.equal(checks.hasAppSidebar(parse(shell(`<nav>${links}</nav>`))), false);
    assert.equal(checks.hasAppSidebar(parse(page(
      `<header><nav></nav></header><aside class="app-sidebar">${links}</aside><nav></nav>`,
    ))), false);
  });

  test('CA-19: rejeita .app-main ausente ou sem #inicio/#destaques no conteúdo', () => {
    assert.ok(checks.hasAppMain(parse(page(
      '<main class="app-main"><div class="app-content">' +
      '<section id="inicio"></section><section id="destaques"></section></div></main>',
    ))));
    assert.ok(checks.hasAppMain(parse(page(
      '<main class="app-main"><section id="inicio"></section><section id="destaques"></section></main>',
    ))));
    assert.equal(checks.hasAppMain(parse(page('<main id="inicio"></main>'))), false);
    assert.equal(checks.hasAppMain(parse(page(
      '<main class="app-main"><div class="app-content"><section id="inicio"></section></div></main>',
    ))), false);
    assert.equal(checks.hasAppMain(parse(page(
      '<div class="app-main"><section id="inicio"></section><section id="destaques"></section></div>' +
      '<section id="inicio"></section>',
    ))), true); // ainda tem ambos sob app-main
    assert.equal(checks.hasAppMain(parse(page(
      '<main class="app-main"><div class="app-content"></div></main>' +
      '<section id="inicio"></section><section id="destaques"></section>',
    ))), false);
  });

  test('CA-20: rejeita CDN HTTP, ausência de bootstrap/adminlte ou styles.css local', () => {
    const links = (items) => items.map((h) => `<link rel="stylesheet" href="${h}">`).join('');
    const ok = links([
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
      'https://cdn.jsdelivr.net/npm/admin-lte@4.0.0/dist/css/adminlte.min.css',
      'css/styles.css',
    ]);
    assert.ok(checks.cdnStylesheets(parse(page('', ok))));
    assert.equal(checks.cdnStylesheets(parse(page('', links([
      'http://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
      'https://cdn.jsdelivr.net/npm/admin-lte@4.0.0/dist/css/adminlte.min.css',
      'css/styles.css',
    ])))), false);
    assert.equal(checks.cdnStylesheets(parse(page('', links([
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
      'css/styles.css',
    ])))), false);
    assert.equal(checks.cdnStylesheets(parse(page('', links([
      'https://cdn.jsdelivr.net/npm/admin-lte@4.0.0/dist/css/adminlte.min.css',
      'css/styles.css',
    ])))), false);
    assert.equal(checks.cdnStylesheets(parse(page('', links([
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
      'https://cdn.jsdelivr.net/npm/admin-lte@4.0.0/dist/css/adminlte.min.css',
    ])))), false);
  });

  test('CA-21: rejeita cards sem .card-body, sem título ou menos de 3 cards', () => {
    const card = (t, body = true) => body
      ? `<div class="card"><div class="card-body"><h3>${t}</h3></div></div>`
      : `<div class="card"><h3>${t}</h3></div>`;
    const section = (inner) => page(`<section id="destaques">${inner}</section>`);
    assert.ok(checks.cardsHaveBody(parse(section(card('A') + card('B') + card('C')))));
    assert.equal(checks.cardsHaveBody(parse(section(card('A') + card('B')))), false);
    assert.equal(checks.cardsHaveBody(parse(section(
      card('A') + card('B') + card('C', false)))), false);
    assert.equal(checks.cardsHaveBody(parse(section(
      card('A') + card('B') + '<div class="card"><div class="card-body"><p>x</p></div></div>'))), false);
    assert.equal(checks.cardsHaveBody(parse(page(card('A') + card('B') + card('C')))), false);
  });
});
