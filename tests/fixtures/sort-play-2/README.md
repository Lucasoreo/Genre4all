# Trechos originais usados nos testes

Origem: [Lucasoreo/Sort-Play-2](https://github.com/Lucasoreo/Sort-Play-2), commit `c1fc205bccfd4200ad0660c75e55e8d138155936`.

Estes arquivos são auxiliares de desenvolvimento. Não são instalados no Spotify, importados pela extensão ou incorporados a `Genre4all.js`.

| Arquivo | Uso |
| --- | --- |
| `src/native-layout.js` | Controlador original que define e redimensiona as colunas do Sort Play 2. |
| `src/genre-service.js` | Serviço original de gêneros, usado para executar o renderizador original junto ao Genre4all. |
| `src/genre-column.js` | Renderizador original de etiquetas; permite testar que os estilos e células não se misturam. |
| `tracklist-structure.js` | Extração sem alterações da função `updateTracklistStructure` de `sort-play.js`; adiciona/remove os dois campos extras originais durante o teste. |
| `LICENSE` | Licença MIT original, copyright (c) 2026 hoeci. |

Os módulos em `src/` e a licença são cópias integrais, sem alterações. `tracklist-structure.js` contém somente a função original indicada; seu contexto é fornecido pela fixture do teste. Ele não é uma extensão instalável.

Os hashes SHA-256 e a origem de cada arquivo estão em [docs/PROVENANCE.json](../../../docs/PROVENANCE.json). Execute `npm run test:provenance` na raiz para conferir a integridade.

O teste de integração usa estas cópias por padrão. `SORT_PLAY_SOURCE` permite apontar para outro checkout do projeto original ao investigar compatibilidade com versões diferentes. A evidência registrada nesta versão corresponde ao commit acima.
