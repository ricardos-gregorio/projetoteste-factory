# AutoVenda — Página de boas-vindas

Página estática (HTML + CSS) de boas-vindas do site de venda de carros.

## Estrutura

- `index.html` — página de boas-vindas
- `css/styles.css` — estilos (mobile-first, com media query para telas ≥ 768px)
- `tests/` — testes automatizados (`node:test` + `jsdom`)

## Visualizar a página

Abra o arquivo `index.html` diretamente no navegador, ou sirva a pasta com qualquer servidor estático, por exemplo:

```bash
npx serve .
# ou
python -m http.server 8000
```

## Rodar os testes

Requer Node.js 21 ou superior.

```bash
npm install
npm test
```
