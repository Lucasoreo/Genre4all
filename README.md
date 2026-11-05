# Genre4all

Extensão independente do [Spicetify](https://spicetify.app/) que adiciona uma coluna de gêneros e estilos às listas de faixas do Spotify Desktop. O arquivo instalável é [Genre4all.js](Genre4all.js), e contém todo o código necessário para executar a extensão.

**Versão atual: 1.14.0.** A validação automatizada está descrita abaixo; a compatibilidade com cada versão do Spotify Desktop depende de teste no próprio cliente.

## Player e visual na versão 1.14.0

Ative **Player Waveform** nas configurações do Genre4all. O desenho usa branco para o trecho reproduzido e cinza para o restante. O envelope utiliza 1024 pontos derivados do início, pico e fim dos segmentos da análise de áudio; o corpo representa energia integrada e os picos preservam ataques. Divisões discretas marcam as seções fornecidas pela análise, com tempo, número do trecho e variação de energia no hover.

Essas informações ajudam a localizar contrastes de intensidade, crescendos e pausas. Não são identificação garantida de kicks, drops ou builds, nem uma waveform PCM do áudio completo. A estrutura dos dados é documentada na [referência de análise de áudio do Spotify](https://developer.spotify.com/documentation/web-api/reference/get-audio-analysis). Quando a análise não está disponível, aparece uma linha neutra com esse aviso; clique, arraste e controles continuam funcionando. A extensão não apresenta um arranjo inventado como se pertencesse à música.

A ilha fica 24 px acima da posição anterior, com entrada dos botões de baixo para cima, começando pelo botão central. Os botões continuam sendo os elementos nativos do Spotify. Hover e foco de teclado revelam a ilha; Escape devolve o foco à waveform. Setas avançam/recuam 5 segundos, Shift + setas 10 segundos, Home/End vão ao início/fim.

As camadas da onda são desenhadas uma vez por faixa/tamanho e reaproveitadas. A atualização acompanha o deslocamento visível do cursor, sem loop contínuo de frames no hover. Não há leitura de geometria a cada movimento global do mouse. O desenho pausa em documento oculto, retorna quando visível e libera eventos ao desligar/remontar. A densidade do canvas é limitada a 2x e o cache de análise contém no máximo 64 faixas compactadas. Animações respeitam movimento reduzido.

Etiquetas preservam suas cores e bordas por fonte, com sombras menores. As preferências receberam contornos de foco e espaçamento visual mais consistente. A versão do cabeçalho do bundle é derivada de `package.json`.

## História do projeto

O Genre4all nasceu de um pedido específico: extrair do **Sort Play 2** apenas a funcionalidade de exibir gêneros em uma coluna e transformá-la em uma extensão independente. A ideia era consultar essa informação diretamente na lista de músicas, com a opção **Gênero** no menu nativo de colunas, sem precisar instalar toda a extensão de origem.

A base utilizada foi o repositório [Lucasoreo/Sort-Play-2](https://github.com/Lucasoreo/Sort-Play-2), no commit [`c1fc205`](https://github.com/Lucasoreo/Sort-Play-2/commit/c1fc205bccfd4200ad0660c75e55e8d138155936), que já continha os módulos de consulta, cache e apresentação dos gêneros. Esse trabalho deriva do [Sort Play de hoeci](https://github.com/hoeci/sort-play), distribuído sob licença MIT.

Na extração, foram reaproveitados e adaptados o serviço de gêneros, o transporte dos metadados do Spotify, a apresentação das etiquetas e os catálogos de validação. O código recebeu nomes, estilos, configurações e banco de dados próprios. O catálogo necessário foi incorporado ao arquivo final, eliminando a necessidade de carregar arquivos do Sort Play em execução.

Para completar a separação, foram implementados uma inicialização própria, um componente de coluna independente, a integração com o menu nativo **Colunas** e um layout que reserva espaço para o novo campo. A convivência com o Sort Play 2 também orientou essas adaptações: o Genre4all pode ser instalado junto dele, inclusive quando suas colunas extras estão ativas.

O resultado mantém o escopo do pedido original: **mostrar gêneros e estilos por faixa**. Recursos de ordenação, criação de playlists, downloads e outras ferramentas do Sort Play 2 ficaram fora do projeto.

## O que a extensão oferece

- Uma coluna **Gênero**, ativada por padrão, antes da duração.
- Reordenação livre por arraste de todas as colunas intermediárias da lista (`Gênero`, `BPM`, `Tom`/`Key`, `Forma de onda`/`Waveform`, `Álbum`, `Adicionada em`, etc.), com persistência da ordem escolhida.
- Opção **Gênero** no menu nativo **Colunas**, aberto pela seta de seleção de detalhes da lista de faixas. A escolha de exibição é lembrada.
- Gêneros em etiquetas com cores estáveis e leque expansível de subgêneros/estilos associados ao passar o mouse ou focar.
- Recarregamento automático transparente caso o cache de gêneros expire após períodos de inatividade, sem necessidade de abrir as configurações manualmente.
- Pipeline de layout e resolução otimizado para playlists grandes (medição de grid cacheada por lista, cache O(1) de identidade por linha e persistência assíncrona não-bloqueante).
- Nenhum ícone adicional na barra do Sort Play. O ícone e as ações dele continuam pertencendo a ele.
- Banco IndexedDB `Genre4allDB`, configurações e CSS exclusivos. Não lê nem escreve no cache ou nas preferências do Sort Play.
- Catálogo de validação incorporado. Spotify funciona sem chave adicional; Discogs aceita token pessoal ou chave/segredo nas configurações.
- Fontes Discogs, MusicBrainz e Spotify, com identificação visual da origem de cada etiqueta.
- Fixação de um gênero/estilo como principal por clique no leque, persistida por faixa.
- Player waveform opcional, com navegação por clique/arraste, BPM, tom musical e controles nativos em ilha flutuante.

## Como funciona

Ao abrir uma lista de faixas, o Genre4all identifica a URI de cada música e adiciona a coluna. Para as linhas visíveis, consulta as fontes habilitadas. Na ordem padrão, Discogs tem prioridade; um resultado do MusicBrainz pode ser complementado por Spotify. O transporte do Spotify usa o serviço interno `MetadataService`. Os resultados passam pelas regras de validação e pelo catálogo de nomes antes de aparecerem como etiquetas.

O serviço mantém um cache próprio, compartilha consultas repetidas e limita o trabalho simultâneo. Quando o Spotify reutiliza uma linha para mostrar outra música, a identidade da faixa é conferida antes de preencher a célula, para evitar que uma resposta antiga seja exibida na música seguinte. Quando um registro expira após inatividade, o recarregamento é enfileirado automaticamente.

| Arquivo | Responsabilidade |
| --- | --- |
| `Genre4all.js` | Arquivo único para instalar no Spicetify; gerado a partir dos fontes. |
| `src/genre-service.js` | Resolução de gêneros, cache, concorrência e cancelamento. |
| `src/genre-transport.js` | Adaptadores Discogs, MusicBrainz e MetadataService, cache IndexedDB e TXT compacto. |
| `src/genre-column.js` | Etiquetas, estados de carregamento e recarregamento automático na expiração. |
| `src/genre-catalog.js` | Aliases, famílias de gêneros, nomes canônicos e validação. |
| `src/player-waveform.js` | Envelope da análise de áudio, seções, seek e ciclo de vida da ilha do player. |
| `src/runtime.js` | Inicialização independente, identificação das faixas, menu, reordenação de colunas e layout. |
| `scripts/build.cjs` | Geração reproduzível do arquivo instalável. |
| `scripts/verify-provenance.cjs` | Confere os hashes dos auxiliares originais de teste. |
| `tests/` | Testes do serviço, catálogo e integração em navegador. |
| `tests/fixtures/sort-play-2/` | Trechos originais fixados em um commit para reproduzir a convivência. |
| `docs/PROVENANCE.json` | Origem e hashes SHA-256 dos arquivos originais. |

## Instalação no Windows

1. Baixe **Genre4all.js**. Preserve o nome e a extensão `.js`.
2. Copie para a pasta `Extensions` da configuração do Spicetify. Normalmente: `%APPDATA%\spicetify\Extensions`. Se a sua instalação usa outra pasta, `spicetify -c` mostra o caminho do arquivo de configuração; `Extensions` fica ao lado desse arquivo.
3. No PowerShell ou terminal, execute:

```powershell
spicetify config extensions Genre4all.js
spicetify apply
```

O comando de configuração adiciona a extensão à lista existente. Mantenha o Sort Play 2 na configuração se quiser usar as duas juntas.

Abra uma playlist e a seta de seleção de colunas. **Gênero** deve aparecer marcado. Ao desmarcar, a coluna desaparece; ao marcar, reaparece. Os gêneros são carregados para as linhas visíveis.

Para remover apenas o Genre4all:

```powershell
spicetify config extensions Genre4all.js-
spicetify apply
```

## Convivência com o Sort Play 2

O componente `genre4all-column` expõe sua semântica de acessibilidade via `ElementInternals`; não se apresenta como uma coluna extra do Sort Play nos seletores DOM dele. Um layout aditivo lê as larguras atuais e reserva mais um espaço para o Genre4all, mantendo a ordem dos outros campos. A rolagem horizontal da lista permite alcançar a nova coluna quando não houver espaço. Ocultar ou descarregar o Genre4all remove os elementos e as regras dele.

Se o Sort Play também estiver configurado para mostrar gênero, as duas colunas coexistem com dados e controles próprios. Para ver somente a do Genre4all, escolha outro detalhe nas colunas do Sort Play.

O arquivo distribuído contém todo o código necessário. **O Sort Play 2 não precisa estar instalado.**

## Fonte dos gêneros e limites do teste

O Spotify fornece conceitos por URI exata via `MetadataService`. Discogs usa correspondência de artista/título/lançamento; MusicBrainz procura gravações e pode aproveitar tags relacionadas. As fontes externas não garantem correspondência exata de cada remix/edição. O catálogo, os aliases e as regras de validação foram extraídos do Sort Play 2 sob licença MIT. Conceitos de humor, países, valores numéricos e rótulos com confiança muito baixa são filtrados. A proveniência fica registrada nas etiquetas e nas resoluções.

Algumas faixas não possuem esses metadados: nesse caso aparece **Sem gêneros**. Arquivos locais aparecem como **Indisponível**. O Spotify pode alterar suas APIs e a estrutura do menu; a versão instalada na máquina do usuário precisa ser validada.

### Validação feita

- 38 testes de catálogo, serviço, decodificação, cache, expiração, cancelamento, concorrência e análise da waveform.
- Integração em Chromium com o transporte Spotify simulado e o **arquivo final completo**.
- Suíte do player com seek, teclado, animação, seções, falta de análise, respostas atrasadas, visibilidade, remontagem, desligamento e largura compacta.
- Menu com opção marcada por padrão, ocultar/reativar, reordenação por arraste de colunas nativas e de gênero, cache, atualização manual, janela estreita, identidade de linhas reutilizadas, estados vazios/erro/local, contêineres aninhados, persistência, carregamento repetido e limpeza.
- Convivência usando as funções originais de layout do Sort Play 2 no commit de origem, nas duas ordens de carregamento, com zero/uma/duas colunas extras e com os dois renderizadores de gênero ativos.

**Esses resultados usam Spotify simulado e não equivalem a uma execução no Spotify Desktop da máquina do usuário.**

## Código e compilação

Requer Node.js. O arquivo distribuído é uma IIFE única, sem dependências de execução.

```sh
npm install
npm run build
npm run check
npm test
```

Os testes de navegador usam Playwright: instale Chromium com `npx playwright install chromium`, se necessário. Os auxiliares originais do Sort Play 2 estão incluídos em `tests/fixtures/sort-play-2/`, portanto o teste de convivência não exige outro checkout. Para investigar outra versão, `SORT_PLAY_SOURCE` pode apontar para um checkout externo. Essa opção existe somente nos testes.

As suítes de navegador interceptam `http://genre4all.test/` e fornecem uma página local simulada, sem servidor ou conta Spotify. As capturas do player são geradas em `test-results/` e não são distribuídas na extensão.

Diagnóstico no console do Spotify: `Genre4all.diagnostics()`. Para reexaminar as linhas: `Genre4all.sync()`. Para ocultar: `Genre4all.setVisible(false)`.

Origem detalhada: [docs/ORIGEM.md](docs/ORIGEM.md). Licença MIT e aviso de copyright preservados no arquivo de distribuição e em [LICENSE](LICENSE).

## Processo de extração e adaptação

### 1. Identificação da base e do escopo

Foi localizado o checkout de `Lucasoreo/Sort-Play-2` e identificado o commit `c1fc205bccfd4200ad0660c75e55e8d138155936`. A análise começou pelos módulos de gênero em `src/`, pelo monólito `sort-play.js`, pela licença e pelos testes já existentes.

A funcionalidade estava distribuída entre o serviço de dados, o transporte, o renderizador das células e funções do monólito responsáveis por obter o cliente de metadados, identificar as músicas e validar os gêneros. Copiar somente o conteúdo visual da célula deixaria essas dependências de fora.

O escopo escolhido foi uma extensão com uma única finalidade: disponibilizar a coluna de gêneros. A coluna deveria vir habilitada, integrar-se à seleção nativa de detalhes e manter o funcionamento das colunas e dos botões do Sort Play 2 quando ambos estivessem instalados.

### 2. Cópia dos módulos de gênero

`genre-service.js`, `genre-transport.js` e `genre-column.js` foram copiados da base e adaptados. A lógica de consulta, decodificação, cache e apresentação foi reaproveitada, em vez de ser substituída por dados de outra fonte.

Os identificadores `SortPlayGenres`, `SortPlayGenreTransport` e `SortPlayGenreColumn` passaram a `Genre4allGenres`, `Genre4allTransport` e `Genre4allColumn`. Os estilos e os identificadores dos elementos também receberam nomes próprios. Isso permite que os dois conjuntos de código coexistam sem declarar as mesmas variáveis ou estilizar as mesmas etiquetas.

O banco original `SortPlayGenresDB` foi substituído por `Genre4allDB`. As áreas de armazenamento de credenciais e vínculos do transporte original foram removidas do transporte adaptado: o Genre4all usa somente `settings` e `cache`.

### 3. Extração do catálogo e das regras

O arquivo `genre-catalog.js` reúne os aliases, famílias de gêneros, mapeamentos de países, conceitos excluídos, nomes canônicos e a validação usados na base. Os nomes do arquivo `assets/genre_playlist_ids.json` foram incorporados; seus identificadores de playlists não eram necessários à exibição e não foram incluídos.

O formato resultante mantém a distinção entre `style`, usado para o nome específico ou subgênero, e `genre`, usado para as famílias associadas. Quando um mesmo nome aparece nas duas categorias, o serviço consolida a etiqueta e registra as categorias correspondentes. Nomes diferentes, como `Electro` e `Electro House`, permanecem separados.

O catálogo fica dentro do arquivo instalável. O Spotify continua sendo consultado para obter os conceitos de cada faixa; o catálogo local serve para validar e apresentar esses conceitos, não para inventar gêneros para músicas sem dados.

### 4. Inicialização independente

O `runtime.js` espera a disponibilidade de `Spicetify.Platform`, cria o armazenamento próprio, monta o serviço e conecta o renderizador às listas de faixas.

A descoberta do `MetadataService` e a leitura da URI foram adaptadas das funções do monólito. O Genre4all procura a classe de serviço nos módulos do cliente Spotify e usa um transporte disponível em `Spicetify.Platform`, reconectando automaticamente caso a instância de transporte mude após inatividade.

O bundle é envolvido em uma função própria. A interface global de diagnóstico é `Genre4all`. Se o arquivo for carregado novamente, a instância anterior é encerrada antes de iniciar a seguinte, evitando uma segunda coluna e observadores duplicados.

### 5. Integração com o menu de colunas

O Genre4all observa a criação dos menus e identifica o menu de detalhes pela estrutura de itens selecionáveis e por rótulos de colunas conhecidos, incluindo os nomes em português e inglês utilizados no código. Quando reconhece esse menu, acrescenta um único item **Gênero**, com marcação correspondente à preferência atual.

O clique nesse item mostra ou oculta a coluna sem alterar as preferências das outras extensões. A navegação por teclado inclui as setas e as teclas Home/End. O item é inserido quando o menu existe; não é necessário manter um menu próprio aberto ou adicionar um novo botão à barra do Sort Play.

### 6. Componente, reordenação de colunas e layout otimizado

Cada célula usa o elemento `genre4all-column`. Sua função acessível de `columnheader` ou `gridcell` é definida com `ElementInternals`, sem adicionar esses atributos `role` ao elemento no DOM comum. Isso evita que os seletores de colunas do Sort Play 2 o tratem como uma coluna nativa ou um de seus campos extras.

O layout identifica as células existentes, mede o grid apenas uma vez por lista/cabeçalho (evitando reflows síncronos por linha em playlists grandes) e distribui o espaço entre as colunas flexíveis. Todas as colunas intermediárias (como `Álbum`, `Adicionada em`, `Forma de onda`, `BPM`, `Tom` e `Gênero`) podem ser arrastadas pelo cabeçalho para qualquer posição intermediária, atualizando tanto o cabeçalho quanto as linhas de dados via `--g4a-position` sem desordenar os nós DOM controlados pelo React.

## Detalhes dos módulos

### Serviço: identidade, resultados e cache

`Genre4allGenres.identityFor()` forma uma identidade cacheada em `WeakMap` a partir da URI e dos metadados disponíveis, incluindo título, artistas, duração, álbum, ISRC e indicação de versão. O adaptador Spotify utiliza a URI exata; os adaptadores externos também usam os metadados disponíveis para buscar correspondências.

`resolve()` consulta o cache e compartilha uma operação em andamento entre consumidores da mesma identidade. Cada consumidor tem seu próprio cancelamento; a operação compartilhada só é abortada quando o último consumidor deixa de utilizá-la. Mudanças de configuração incrementam uma revisão e invalidam resoluções incompatíveis.

| Parâmetro | Valor nesta versão |
| --- | --- |
| Provedores | `discogs`, `musicbrainz`, `spotify` |
| Validade do cache | Spotify: 1 hora; Discogs/MusicBrainz: 30 dias |
| Limite de entradas de cache do provedor | 2000 |
| Limite de resoluções em memória | 2000 |
| Espaçamento mínimo entre consultas no limitador | 25 ms |
| Limite da fila do serviço Spotify | 256 |
| Tarefas simultâneas iniciadas pela apresentação | 24 |
| Margem de pré-carregamento da área visível | 112 px |

Quando o tempo de validade do cache expira, o serviço e o controlador de coluna reenfileiram automaticamente as faixas visíveis para recarregamento transparente.

### Transporte e decodificação

`createSpotifyAdapter()` envia ao serviço existente no cliente uma consulta no formato:

```js
{
  extensionQuery: [
    { extensionKind: 6, entityUri: [uri] }
  ]
}
```

A resposta é conferida para não preencher uma faixa com dados de outra URI. Ausência de conteúdo ou resposta 404 resulta em lista vazia; serviço ausente ou formato incompatível produz um estado de indisponibilidade. O transporte espera brevemente pelo cliente durante a inicialização e limita a espera de cada consulta a 12 segundos.

`decodeConcepts()` interpreta os bytes Protobuf dos conceitos, reconhece escores quando presentes, remove o prefixo `spotify:concept:`, transforma sublinhados em espaços e ordena conceitos pontuados por relevância. O serviço descarta confiança de até 5%; o catálogo também exclui conceitos que não sejam gêneros válidos segundo suas regras.

### Apresentação e proteção de linhas reutilizadas

`Genre4allColumn.createController()` acompanha as células e sua visibilidade com índice O(1) por linha. Antes de aplicar um resultado, confere se a célula ainda existe, se continua na mesma linha, se a URI e a identidade são as mesmas, se o contexto não mudou, se a coluna segue habilitada e se a revisão do serviço ainda corresponde à tarefa.

## Dados locais e preferências

| Local | Conteúdo |
| --- | --- |
| `localStorage`, chave `genre4all-visible-v1` | Se a coluna está visível. Na ausência de escolha, começa visível. |
| `localStorage`, chave `genre4all-order-offset-v1` | Deslocamento relativo da coluna de gênero. |
| `localStorage`, chave `genre4all-column-order-v1` | Ordem personalizada de todas as colunas intermediárias. |
| IndexedDB `Genre4allDB`, área `settings` | Exibição de gêneros principais, estilos e cores. |
| IndexedDB `Genre4allDB`, área `cache` | Resultados e expiração das consultas por faixa. |
| `localStorage`, chave `genre4all-player-waveform-v1` | Ativação opcional do player waveform. |
| `localStorage`, chave `genre4all-pinned-genres-v1` | Gêneros fixados por faixa; sincronizados com as configurações locais. |
| `localStorage`, chave `genre4all-cache-txt-v11` | Cache compacto limitado a 2000 registros. |
| Memória da instância | Fila, consumidores, células, tarefas e cache temporário. |

## Manutenção e diagnóstico

Faça alterações em `src/` e execute `npm run build` para atualizar a distribuição. `npm run check` compara o arquivo gerado com os fontes e verifica sua sintaxe. Não edite somente `Genre4all.js`, pois a próxima compilação substituirá essa edição.

No console do Spotify, os comandos abaixo ajudam a identificar o estado da instância:

```js
Genre4all.diagnostics();      // Versão, contexto, ordem de colunas, células e estado do serviço.
Genre4all.visible;            // Preferência atual de exibição.
Genre4all.columnOrder;        // Ordem atual das colunas intermediárias.
Genre4all.sync();             // Agenda nova verificação das listas e menus.
Genre4all.setVisible(false);  // Oculta a coluna e salva a preferência.
Genre4all.setVisible(true);   // Reativa a coluna.
Genre4all.close();            // Encerra a instância até o próximo carregamento.
```
