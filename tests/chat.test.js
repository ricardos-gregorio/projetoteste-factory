import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML_URL = new URL('../chat.html', import.meta.url);
const LEGACY_HTML_URL = new URL('../destaque.html', import.meta.url);
const CSS_URL = new URL('../css/styles.css', import.meta.url);

const stripBom = (s) => s.replace(/^\uFEFF/, '');
const readText = (url) => stripBom(fs.readFileSync(url, 'utf8'));

const rawHtml = fs.existsSync(HTML_URL) ? readText(HTML_URL) : '';
const rawCss = fs.existsSync(CSS_URL) ? readText(CSS_URL) : '';

const parse = (html) => new JSDOM(html).window.document;
const document = parse(rawHtml);

const page = (body, head = '') =>
  `<!DOCTYPE html><html lang="pt-BR"><head>${head}</head><body>${body}</body></html>`;

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const hrefMatches = (actual, allowed) =>
  allowed.some((a) => actual === a || actual?.startsWith(`${a}#`) || actual === `${a}`);

// ---------------------------------------------------------------------------
// Verificadores: caminho feliz (página real) + fixtures defeituosas (borda).
// ---------------------------------------------------------------------------
const checks = {
  doctype: (html) => /^\s*<!doctype html>/i.test(stripBom(html)),
  langPtBR: (doc) => doc.documentElement.getAttribute('lang') === 'pt-BR',
  charsetAndViewport: (doc) => {
    const charset = doc.head.querySelector('meta[charset]');
    const viewport = doc.head.querySelector('meta[name="viewport"]');
    return Boolean(
      charset &&
        charset.getAttribute('charset').trim().toLowerCase() === 'utf-8' &&
        viewport &&
        /width\s*=\s*device-width/i.test(viewport.getAttribute('content') ?? ''),
    );
  },
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
    const lower = title.toLowerCase();
    return (
      /autovenda|destaque|chat/i.test(title) ||
      (brand.length > 0 && lower.includes(brand.toLowerCase()))
    );
  },
  descriptionValid: (doc) => {
    const meta = doc.head.querySelector('meta[name="description"]');
    return (meta?.getAttribute('content') ?? '').trim().length > 0;
  },
  hasAppWrapper: (doc) => {
    const wrappers = [...(doc.body?.querySelectorAll('.app-wrapper') ?? [])];
    return wrappers.some((el) => el.parentElement === doc.body);
  },
  hasAppHeader: (doc) => {
    const appHeader = doc.querySelector('.app-header');
    if (!appHeader) return false;
    const header = doc.querySelector('header');
    if (!header) return false;
    const headerOk =
      appHeader === header || appHeader.contains(header) || header.contains(appHeader);
    if (!headerOk) return false;
    const brandOk = Boolean(
      appHeader.querySelector('.brand, .brand-link, .brand-text') ||
        header.querySelector('.brand, .brand-link, .brand-text'),
    );
    const nav = doc.querySelector('nav');
    return brandOk && Boolean(nav) && (appHeader.contains(nav) || header.contains(nav));
  },
  /** Sidebar AutoVenda na página chat: Início→index, Chat→chat (ou self #), Contato→index#contato */
  hasAppSidebar: (doc) => {
    const sidebar = doc.querySelector('.app-sidebar');
    if (!sidebar) return false;
    if (sidebar.querySelector('nav') || doc.querySelectorAll('nav').length !== 1) return false;
    const byText = (text) =>
      [...sidebar.querySelectorAll('a')].find((a) => a.textContent.trim() === text);
    const inicio = byText('Início');
    const chat = byText('Chat');
    const contato = byText('Contato');
    if (!inicio || !chat || !contato) return false;
    const inicioOk = hrefMatches(inicio.getAttribute('href'), ['index.html']);
    const chatHref = chat.getAttribute('href') ?? '';
    const chatOk =
      ['chat.html', '#', ''].includes(chatHref) ||
      ['chat.html', '#'].includes((chatHref.split('#')[0] || chatHref));
    const contatoHref = contato.getAttribute('href') ?? '';
    const contatoOk =
      contatoHref === 'index.html#contato' ||
      /^index\.html#contato$/i.test(contatoHref);
    return inicioOk && chatOk && contatoOk;
  },
  /** Issue #9 CA-5: HTML da página chat sem destaque.html nem âncora de menu Destaques. */
  noLegacyDestaquesMenu: (html) => {
    if (/destaque\.html/i.test(html)) return false;
    return !/<a\b[^>]*>\s*Destaques\s*<\/a>/i.test(html);
  },
  hasAppMain: (doc) => Boolean(doc.querySelector('.app-main')),
  footerHasCopyright: (doc) => {
    const footer = doc.querySelector('footer, .app-footer');
    return Boolean(footer && /©|direitos/i.test(footer.textContent));
  },
  singleNav: (doc) => doc.querySelectorAll('nav').length === 1,
  noScriptNoInlineStyle: (doc) =>
    doc.querySelectorAll('script').length === 0 && doc.querySelectorAll('[style]').length === 0,
  cdnStylesheets: (doc) => {
    const hrefs = [...doc.head.querySelectorAll('link[rel~="stylesheet"]')].map(
      (l) => l.getAttribute('href') ?? '',
    );
    const https = hrefs.filter((h) => /^https:\/\//i.test(h));
    const hasBootstrap = https.some((h) => /bootstrap(?!-icons)/i.test(h) || /\/bootstrap@/i.test(h));
    const hasAdminLte = https.some((h) => /adminlte|admin-lte/i.test(h));
    const hasIcons = https.some((h) => /bootstrap-icons/i.test(h));
    const hasLocal = hrefs.some((h) => /^css\/.+\.css$/i.test(h));
    return hasBootstrap && hasAdminLte && hasIcons && hasLocal;
  },
  chatAppStructure: (doc) => {
    const root = doc.querySelector('.app-main') ?? doc.querySelector('.app-content');
    if (!root) return false;
    const apps = root.querySelectorAll('.chat-app');
    if (apps.length !== 1) return false;
    const app = apps[0];
    return Boolean(app.querySelector('.chat-contacts') && app.querySelector('.chat-conversation'));
  },
  contactName: (el) => {
    const named = el.querySelector('p, .fw-semibold, strong, .chat-contact-name');
    const text = (named?.textContent ?? el.textContent ?? '').trim();
    return text;
  },
  contactsValid: (doc) => {
    const list = doc.querySelector('.chat-contacts');
    if (!list) return false;
    const contacts = [...list.querySelectorAll('.chat-contact')];
    if (contacts.length < 7) return false;
    const active = contacts.filter((c) => c.classList.contains('active'));
    if (active.length !== 1) return false;
    return contacts.every(
      (c) => Boolean(c.querySelector('.chat-avatar')) && checks.contactName(c).length > 0,
    );
  },
  conversationValid: (doc) => {
    const conv = doc.querySelector('.chat-conversation');
    if (!conv) return false;
    const header = conv.querySelector('.chat-header');
    if (!header || !(header.textContent ?? '').trim()) return false;
    const messagesEl = conv.querySelector('#chat-messages.chat-messages, #chat-messages');
    if (!messagesEl || !messagesEl.classList.contains('chat-messages')) return false;
    const messages = [...conv.querySelectorAll('.chat-message')];
    if (messages.length < 6) return false;
    if (!messages.some((m) => m.classList.contains('them'))) return false;
    if (!messages.some((m) => m.classList.contains('me'))) return false;
    return messages.every((m) => {
      const bubble = m.querySelector('.chat-bubble');
      const time = m.querySelector('.chat-time');
      return (
        Boolean(bubble) &&
        Boolean(time) &&
        (bubble.textContent ?? '').trim().length > 0 &&
        (time.textContent ?? '').trim().length > 0
      );
    });
  },
  composerValid: (doc) => {
    const form = doc.querySelector('form#chat-composer.chat-composer');
    if (!form) return false;
    const input = form.querySelector('input#chat-input');
    if (!input || (input.getAttribute('type') ?? 'text').toLowerCase() !== 'text') return false;
    const submit =
      form.querySelector('button[type="submit"], input[type="submit"]') ||
      form.querySelector('button.btn-primary');
    if (!submit) return false;
    const action = form.getAttribute('action');
    return action === null || action === '' || action === '#';
  },
  chatCssRules: (css) => {
    const clean = stripCssComments(css);
    const needed = [
      '.chat-app',
      '.chat-contacts',
      '.chat-contact',
      '.chat-conversation',
      '.chat-messages',
      '.chat-message',
      '.chat-bubble',
    ];
    if (!needed.every((sel) => clean.includes(sel))) return false;
    // Viewport estreita: @media max-width (ou equivalente) afetando chat (esconde contatos / 1 coluna)
    const mediaRe =
      /@media[^{]*max-width\s*:\s*\d+/i;
    if (!mediaRe.test(clean)) return false;
    // Dentro de algum bloco @media max-width, deve haver referência a chat (colapso)
    const blocks = [...clean.matchAll(/@media[^{]*max-width\s*:\s*(\d+)[^{]*\{([\s\S]*?)(?=\n\}\s*(?:\/\*|\.|\@|$))/gi)];
    // Fallback mais simples: existe @media (max-width: …) e nele .chat-contacts ou grid 1fr
    const simple = /@media[^{]*max-width[\s\S]{0,200}?\{[\s\S]*?\.chat-(?:app|contacts)/i.test(clean);
    return simple || blocks.some((m) => /\.chat-(?:app|contacts)/i.test(m[2] ?? ''));
  },
  navLinksValid: (doc) => {
    const byText = (scope, text) =>
      [...scope.querySelectorAll('a')].find((a) => a.textContent.trim() === text);
    const headerNav = doc.querySelector('header nav') ?? doc.querySelector('nav');
    const sidebar = doc.querySelector('.app-sidebar');
    if (!headerNav || !sidebar) return false;
    for (const scope of [headerNav, sidebar]) {
      const inicio = byText(scope, 'Início');
      const chat = byText(scope, 'Chat');
      const contato = byText(scope, 'Contato');
      if (!inicio || !chat || !contato) return false;
      if (!hrefMatches(inicio.getAttribute('href'), ['index.html'])) return false;
      const cHref = chat.getAttribute('href') ?? '';
      if (!(cHref === 'chat.html' || cHref === '#' || cHref === '')) return false;
      if ((contato.getAttribute('href') ?? '') !== 'index.html#contato') return false;
    }
    return true;
  },
  brokenAnchors: (doc) =>
    [...doc.querySelectorAll('a[href^="#"]')]
      .map((a) => a.getAttribute('href'))
      .filter((href) => href !== '#')
      .filter((href) => {
        let id = href.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          /* fragmento malformado */
        }
        return !doc.getElementById(id);
      }),
};

describe('página chat', () => {
  test('CA-1 / issue #9 CA-1: chat.html existe, destaque.html ausente, doctype HTML5, lang=pt-BR, charset UTF-8 e viewport', () => {
    assert.ok(fs.existsSync(HTML_URL), 'chat.html deve existir na raiz');
    assert.equal(fs.existsSync(LEGACY_HTML_URL), false, 'destaque.html não deve mais existir');
    assert.ok(checks.doctype(rawHtml), 'chat.html deve começar com <!DOCTYPE html>');
    assert.equal(document.documentElement.getAttribute('lang'), 'pt-BR');
    assert.ok(checks.langPtBR(document));
    assert.ok(checks.charsetAndViewport(document));
  });

  test('CA-2: title não vazio (AutoVenda/destaque/chat) e meta description não vazia', () => {
    const title = document.title.trim();
    assert.ok(title.length > 0, 'title vazio');
    assert.ok(checks.titleValid(document), `title "${title}" inválido`);
    assert.ok(checks.descriptionValid(document), 'meta description ausente ou vazia');
  });

  test('CA-3: shell AdminLTE (.app-wrapper, header, sidebar, main, footer) e um único <nav>', () => {
    assert.ok(checks.hasAppWrapper(document), '.app-wrapper deve ser filho direto de body');
    assert.ok(checks.hasAppHeader(document), '.app-header com marca e nav');
    assert.ok(checks.singleNav(document), 'exatamente um <nav>');
    assert.ok(checks.hasAppSidebar(document), '.app-sidebar sem <nav> e com links');
    assert.ok(checks.hasAppMain(document), '.app-main ausente');
    assert.ok(checks.footerHasCopyright(document), 'footer com © ou direitos');
  });

  test('CA-4: CDN HTTPS Bootstrap, AdminLTE, Bootstrap Icons + css local; sem script/inline', () => {
    assert.ok(checks.cdnStylesheets(document), 'folhas CDN/local incompletas');
    assert.equal(document.querySelectorAll('script').length, 0);
    assert.equal(document.querySelectorAll('[style]').length, 0);
    assert.ok(checks.noScriptNoInlineStyle(document));
  });

  test('CA-5: exatamente um .chat-app sob main/content com contacts + conversation', () => {
    assert.ok(checks.chatAppStructure(document));
    const main = document.querySelector('.app-main');
    assert.equal(main.querySelectorAll('.chat-app').length, 1);
  });

  test('CA-6: ≥7 .chat-contact, exatamente um .active, cada um com avatar e nome', () => {
    assert.ok(checks.contactsValid(document));
    const contacts = document.querySelectorAll('.chat-contacts .chat-contact');
    assert.ok(contacts.length >= 7, `esperado ≥7 contatos, encontrado ${contacts.length}`);
    assert.equal(
      document.querySelectorAll('.chat-contacts .chat-contact.active').length,
      1,
    );
  });

  test('CA-7: chat-header, #chat-messages, ≥6 mensagens them/me com bubble e time', () => {
    assert.ok(checks.conversationValid(document));
    const msgs = document.querySelectorAll('.chat-conversation .chat-message');
    assert.ok(msgs.length >= 6);
    assert.ok(document.querySelector('.chat-message.them'));
    assert.ok(document.querySelector('.chat-message.me'));
  });

  test('CA-8: form#chat-composer com #chat-input text e submit; action seguro', () => {
    assert.ok(checks.composerValid(document));
    const form = document.querySelector('form#chat-composer.chat-composer');
    assert.ok(form);
    const action = form.getAttribute('action');
    assert.ok(action === null || action === '' || action === '#');
  });

  test('CA-9: css/styles.css define .chat-* e @media mobile que colapsa o grid', () => {
    assert.ok(fs.existsSync(CSS_URL), 'css/styles.css ausente');
    assert.ok(checks.chatCssRules(rawCss), 'regras .chat-* ou @media mobile ausentes');
  });

  test('CA-11 / issue #9 CA-4: nav Início→index.html, Chat→chat.html, Contato→index.html#contato; âncoras ok', () => {
    assert.ok(checks.navLinksValid(document));
    assert.ok(checks.hasAppSidebar(document));
    const chatLinks = [
      ...document.querySelectorAll('header nav a'),
      ...document.querySelectorAll('.app-sidebar a'),
    ].filter((a) => a.textContent.trim() === 'Chat');
    assert.ok(chatLinks.length >= 2, 'esperado link Chat no header e na sidebar');
    for (const a of chatLinks) {
      const href = a.getAttribute('href') ?? '';
      assert.ok(href === 'chat.html' || href === '#' || href === '', `href Chat inválido: ${href}`);
    }
    assert.deepEqual(checks.brokenAnchors(document), []);
    assert.ok(checks.noLegacyDestaquesMenu(rawHtml), 'chat.html não deve citar destaque.html nem menu Destaques');
  });
});

describe('casos de borda e de erro dos verificadores (chat)', () => {
  test('CA-1: doctype e lang rejeitam ausência / valores inválidos', () => {
    assert.ok(checks.doctype('\uFEFF<!DOCTYPE html>'));
    assert.equal(checks.doctype('<html></html>'), false);
    assert.equal(checks.langPtBR(parse('<!DOCTYPE html><html lang="en"><body></body></html>')), false);
    assert.ok(checks.langPtBR(parse(page(''))));
  });

  test('CA-1: charset/viewport rejeitam ausência ou valores incorretos', () => {
    const vp = '<meta name="viewport" content="width=device-width, initial-scale=1">';
    assert.ok(checks.charsetAndViewport(parse(page('', '<meta charset="UTF-8">' + vp))));
    assert.equal(checks.charsetAndViewport(parse(page('', vp))), false);
    assert.equal(checks.charsetAndViewport(parse(page('', '<meta charset="UTF-8">'))), false);
  });

  test('CA-2: rejeita title vazio/sem marca-destaque-chat e description vazia', () => {
    assert.equal(checks.titleValid(parse(page('', '<title>   </title>'))), false);
    assert.equal(checks.titleValid(parse(page('', '<title>Página X</title>'))), false);
    assert.ok(checks.titleValid(parse(page('', '<title>AutoVenda Chat</title>'))));
    assert.ok(checks.titleValid(parse(page('', '<title>Página destaque</title>'))));
    assert.equal(checks.descriptionValid(parse(page(''))), false);
    assert.equal(checks.descriptionValid(parse(page('', '<meta name="description" content="  ">'))), false);
    assert.ok(checks.descriptionValid(parse(page('', '<meta name="description" content="Atendimento">'))));
  });

  test('CA-3: rejeita shell incompleto (wrapper, header, sidebar com nav, footer sem ©)', () => {
    assert.equal(checks.hasAppWrapper(parse(page('<main></main>'))), false);
    assert.ok(checks.hasAppWrapper(parse(page('<div class="app-wrapper"></div>'))));
    assert.equal(
      checks.hasAppHeader(
        parse(page('<header class="app-header"><nav></nav></header>')),
      ),
      false,
    );
    const links =
      '<a href="index.html">Início</a><a href="chat.html">Chat</a><a href="index.html#contato">Contato</a>';
    const shell = (side) =>
      page(
        `<header><nav><a href="index.html">Início</a></nav></header>` +
          `<aside class="app-sidebar">${side}</aside>`,
      );
    assert.ok(checks.hasAppSidebar(parse(shell(links))));
    assert.ok(checks.hasAppSidebar(parse(shell(
      '<a href="index.html">Início</a><a href="#">Chat</a><a href="index.html#contato">Contato</a>',
    ))));
    assert.equal(checks.hasAppSidebar(parse(shell(`<nav>${links}</nav>`))), false);
    assert.equal(checks.hasAppSidebar(parse(shell('<a href="index.html">Início</a>'))), false);
    assert.equal(checks.hasAppSidebar(parse(shell(
      '<a href="index.html">Início</a><a href="destaque.html">Destaques</a><a href="index.html#contato">Contato</a>',
    ))), false);
    assert.equal(checks.hasAppSidebar(parse(shell(
      '<a href="index.html">Início</a><a href="destaque.html">Chat</a><a href="index.html#contato">Contato</a>',
    ))), false);
    assert.equal(checks.footerHasCopyright(parse(page('<footer>AutoVenda</footer>'))), false);
    assert.ok(checks.footerHasCopyright(parse(page('<footer class="app-footer">© 2026</footer>'))));
  });

  test('CA-4: rejeita ausência de bootstrap-icons, HTTP inseguro ou script/inline', () => {
    const links = (items) => items.map((h) => `<link rel="stylesheet" href="${h}">`).join('');
    const ok = links([
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
      'https://cdn.jsdelivr.net/npm/admin-lte@4.0.0/dist/css/adminlte.min.css',
      'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.min.css',
      'css/styles.css',
    ]);
    assert.ok(checks.cdnStylesheets(parse(page('', ok))));
    assert.equal(
      checks.cdnStylesheets(
        parse(
          page(
            '',
            links([
              'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
              'https://cdn.jsdelivr.net/npm/admin-lte@4.0.0/dist/css/adminlte.min.css',
              'css/styles.css',
            ]),
          ),
        ),
      ),
      false,
    );
    assert.equal(checks.noScriptNoInlineStyle(parse(page('<script></script>'))), false);
    assert.equal(checks.noScriptNoInlineStyle(parse(page('<p style="color:red">x</p>'))), false);
  });

  test('CA-5: rejeita zero/dois .chat-app ou ausência de contacts/conversation', () => {
    assert.equal(
      checks.chatAppStructure(
        parse(page('<main class="app-main"><div class="chat-app"></div></main>')),
      ),
      false,
    );
    assert.ok(
      checks.chatAppStructure(
        parse(
          page(
            '<main class="app-main"><div class="chat-app">' +
              '<div class="chat-contacts"></div><div class="chat-conversation"></div></div></main>',
          ),
        ),
      ),
    );
    assert.equal(
      checks.chatAppStructure(
        parse(
          page(
            '<main class="app-main">' +
              '<div class="chat-app"><div class="chat-contacts"></div><div class="chat-conversation"></div></div>' +
              '<div class="chat-app"><div class="chat-contacts"></div><div class="chat-conversation"></div></div>' +
              '</main>',
          ),
        ),
      ),
      false,
    );
  });

  test('CA-6: rejeita <7 contatos, zero/dois active, sem avatar ou nome vazio', () => {
    const contact = (name, active = false) =>
      `<a class="chat-contact${active ? ' active' : ''}"><span class="chat-avatar">X</span><p>${name}</p></a>`;
    const seven = Array.from({ length: 7 }, (_, i) => contact(`N${i}`, i === 0)).join('');
    assert.ok(
      checks.contactsValid(parse(page(`<div class="chat-contacts">${seven}</div>`))),
    );
    assert.equal(
      checks.contactsValid(
        parse(page(`<div class="chat-contacts">${contact('A', true)}${contact('B')}</div>`)),
      ),
      false,
    );
    const twoActive = Array.from({ length: 7 }, (_, i) => contact(`N${i}`, i < 2)).join('');
    assert.equal(
      checks.contactsValid(parse(page(`<div class="chat-contacts">${twoActive}</div>`))),
      false,
    );
    const noAvatar = Array.from({ length: 7 }, (_, i) =>
      i === 0
        ? '<a class="chat-contact active"><p>Nome</p></a>'
        : contact(`N${i}`),
    ).join('');
    assert.equal(
      checks.contactsValid(parse(page(`<div class="chat-contacts">${noAvatar}</div>`))),
      false,
    );
  });

  test('CA-7: rejeita poucas mensagens, só them/me, ou bubble/time vazios', () => {
    const msg = (side, text = 'oi', time = '10:00') =>
      `<div class="chat-message ${side}"><div class="chat-bubble">${text}<span class="chat-time">${time}</span></div></div>`;
    const six =
      msg('them') + msg('me') + msg('them') + msg('me') + msg('them') + msg('me');
    const ok = page(
      `<div class="chat-conversation"><div class="chat-header">Olivia</div>` +
        `<div id="chat-messages" class="chat-messages">${six}</div></div>`,
    );
    assert.ok(checks.conversationValid(parse(ok)));
    assert.equal(
      checks.conversationValid(
        parse(
          page(
            `<div class="chat-conversation"><div class="chat-header">X</div>` +
              `<div id="chat-messages" class="chat-messages">${msg('them')}${msg('me')}</div></div>`,
          ),
        ),
      ),
      false,
    );
    const onlyThem = Array.from({ length: 6 }, () => msg('them')).join('');
    assert.equal(
      checks.conversationValid(
        parse(
          page(
            `<div class="chat-conversation"><div class="chat-header">X</div>` +
              `<div id="chat-messages" class="chat-messages">${onlyThem}</div></div>`,
          ),
        ),
      ),
      false,
    );
    const emptyTime =
      msg('them') +
      msg('me') +
      msg('them') +
      msg('me') +
      msg('them') +
      `<div class="chat-message me"><div class="chat-bubble">x<span class="chat-time">  </span></div></div>`;
    assert.equal(
      checks.conversationValid(
        parse(
          page(
            `<div class="chat-conversation"><div class="chat-header">X</div>` +
              `<div id="chat-messages" class="chat-messages">${emptyTime}</div></div>`,
          ),
        ),
      ),
      false,
    );
  });

  test('CA-8: rejeita composer sem id/classe, input não-text, submit ausente ou action externa', () => {
    const ok = page(
      '<form id="chat-composer" class="chat-composer" action="#">' +
        '<input id="chat-input" type="text">' +
        '<button type="submit">Send</button></form>',
    );
    assert.ok(checks.composerValid(parse(ok)));
    assert.equal(
      checks.composerValid(
        parse(
          page(
            '<form id="chat-composer" class="chat-composer" action="/api">' +
              '<input id="chat-input" type="text"><button type="submit">S</button></form>',
          ),
        ),
      ),
      false,
    );
    assert.equal(
      checks.composerValid(
        parse(
          page(
            '<form id="chat-composer" class="chat-composer">' +
              '<input id="chat-input" type="search"><button type="submit">S</button></form>',
          ),
        ),
      ),
      false,
    );
    assert.equal(
      checks.composerValid(
        parse(
          page(
            '<form id="chat-composer" class="chat-composer">' +
              '<input id="chat-input" type="text"></form>',
          ),
        ),
      ),
      false,
    );
    assert.ok(
      checks.composerValid(
        parse(
          page(
            '<form id="chat-composer" class="chat-composer">' +
              '<input id="chat-input" type="text"><button class="btn-primary" type="button">S</button></form>',
          ),
        ),
      ),
    );
  });

  test('CA-9: rejeita CSS sem seletores .chat-* ou sem @media max-width do chat', () => {
    const ok = `
      .chat-app {} .chat-contacts {} .chat-contact {} .chat-conversation {}
      .chat-messages {} .chat-message {} .chat-bubble {}
      @media (max-width: 768px) { .chat-app { grid-template-columns: 1fr; } .chat-contacts { display: none; } }
    `;
    assert.ok(checks.chatCssRules(ok));
    assert.equal(checks.chatCssRules('.chat-app {} .chat-contacts {}'), false);
    assert.equal(
      checks.chatCssRules(`
        .chat-app {} .chat-contacts {} .chat-contact {} .chat-conversation {}
        .chat-messages {} .chat-message {} .chat-bubble {}
        @media (min-width: 768px) { .chat-app {} }
      `),
      false,
    );
    assert.equal(
      checks.chatCssRules(`
        .chat-app {} .chat-contacts {} .chat-contact {} .chat-conversation {}
        .chat-messages {} .chat-message {} .chat-bubble {}
        /* @media (max-width: 768px) { .chat-contacts { display: none; } } */
      `),
      false,
    );
  });

  test('CA-11 / issue #9 CA-4: rejeita hrefs incoerentes e detecta âncora quebrada (ignora href="#")', () => {
    const nav = (i, d, c, label = 'Chat') =>
      page(
        `<header><nav>` +
          `<a href="${i}">Início</a><a href="${d}">${label}</a><a href="${c}">Contato</a>` +
          `</nav></header>` +
          `<aside class="app-sidebar">` +
          `<a href="${i}">Início</a><a href="${d}">${label}</a><a href="${c}">Contato</a>` +
          `</aside>`,
      );
    assert.ok(checks.navLinksValid(parse(nav('index.html', 'chat.html', 'index.html#contato'))));
    assert.ok(checks.navLinksValid(parse(nav('index.html', '#', 'index.html#contato'))));
    assert.equal(
      checks.navLinksValid(parse(nav('index.html', '#destaques', 'index.html#contato'))),
      false,
    );
    assert.equal(
      checks.navLinksValid(parse(nav('#inicio', 'chat.html', 'index.html#contato'))),
      false,
    );
    assert.equal(
      checks.navLinksValid(parse(nav('index.html', 'destaque.html', 'index.html#contato'))),
      false,
    );
    assert.equal(
      checks.navLinksValid(parse(nav('index.html', 'chat.html', 'index.html#contato', 'Destaques'))),
      false,
    );
    const doc = parse(
      page('<a href="#">ok</a><a href="#sumiu">x</a><div id="ok"></div><a href="#ok">ok</a>'),
    );
    assert.deepEqual(checks.brokenAnchors(doc), ['#sumiu']);
  });

  test('issue #9 CA-5: rejeita HTML legado com destaque.html ou menu Destaques', () => {
    assert.ok(checks.noLegacyDestaquesMenu('<a href="chat.html">Chat</a>'));
    assert.equal(checks.noLegacyDestaquesMenu('<a href="destaque.html">Chat</a>'), false);
    assert.equal(checks.noLegacyDestaquesMenu('<a href="chat.html">Destaques</a>'), false);
  });
});
