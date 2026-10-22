# Origem do código

Fonte: https://github.com/Lucasoreo/Sort-Play-2
Commit: c1fc205bccfd4200ad0660c75e55e8d138155936
Licença MIT; copyright (c) 2026 hoeci. Licença integral também no arquivo de distribuição.

- `src/genre-service.js`, `genre-transport.js`, `genre-column.js`: copiados da fonte e adaptados para nomes, banco e estilos exclusivos Genre4all.
- `src/genre-catalog.js`: aliases, famílias, países, conceitos excluídos, validação e nomes canônicos extraídos do monólito; catálogo de nomes incorporado de `assets/genre_playlist_ids.json`. Não inclui funções de playlists.
- `src/runtime.js`: inicialização e integração independentes. Descoberta do MetadataService e extração de URI adaptadas do monólito. Layout aditivo e item no menu nativo são novos.
- `tests/genre-service.test.cjs`: testes de serviço reaproveitados do original, apontando para o módulo adaptado do Genre4all.
- `tests/fixtures/sort-play-2/src/native-layout.js`, `genre-service.js` e `genre-column.js`: cópias integrais originais para os testes de convivência. Não entram no arquivo instalável.
- `tests/fixtures/sort-play-2/tracklist-structure.js`: extração sem alterações da função original `updateTracklistStructure`; executada somente na fixture de navegador.
- `tests/fixtures/sort-play-2/LICENSE`: cópia da licença original para acompanhar os auxiliares.

O registro legível por máquina em [PROVENANCE.json](PROVENANCE.json) identifica o repositório, o commit, os arquivos de origem e os hashes SHA-256. Os arquivos auxiliares originais podem ser conferidos com `npm run test:provenance`.

Os nomes de gêneros de `assets/genre_playlist_ids.json` foram incorporados a `src/genre-catalog.js`; os identificadores de playlists foram descartados porque não são necessários à coluna. O catálogo é distribuído como parte do código, sem download adicional na inicialização.

O arquivo instalado não inclui a interface, botões, ordenação, downloads, áudio, recomendações ou demais funcionalidades do Sort Play 2. Nenhum módulo é carregado dessa extensão em execução. A interface original de layout existe apenas nos auxiliares de teste e fica fora do bundle, cuja lista de entrada é explícita em `scripts/build.cjs`.
