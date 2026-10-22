# Genre4all

Extensão independente do [Spicetify](https://spicetify.app/) que adiciona uma coluna de gêneros e estilos às listas de faixas do Spotify Desktop. O arquivo instalável é [Genre4all.js](Genre4all.js), e contém todo o código necessário para executar a extensão.

**Versão atual: 0.1.0-test.** A validação automatizada está descrita abaixo; a compatibilidade com cada versão do Spotify Desktop depende de teste no próprio cliente.

## História do projeto

O Genre4all nasceu de um pedido específico: extrair do **Sort Play 2** apenas a funcionalidade de exibir gêneros em uma coluna e transformá-la em uma extensão independente. A ideia era consultar essa informação diretamente na lista de músicas, com a opção **Gênero** no menu nativo de colunas, sem precisar instalar toda a extensão de origem.

A base utilizada foi o repositório [Lucasoreo/Sort-Play-2](https://github.com/Lucasoreo/Sort-Play-2), no commit [`c1fc205`](https://github.com/Lucasoreo/Sort-Play-2/commit/c1fc205bccfd4200ad0660c75e55e8d138155936), que já continha os módulos de consulta, cache e apresentação dos gêneros. Esse trabalho deriva do [Sort Play de hoeci](https://github.com/hoeci/sort-play), distribuído sob licença MIT.

Na extração, foram reaproveitados e adaptados o serviço de gêneros, o transporte dos metadados do Spotify, a apresentação das etiquetas e os catálogos de validação. O código recebeu nomes, estilos, configurações e banco de dados próprios. O catálogo necessário foi incorporado ao arquivo final, eliminando a necessidade de carregar arquivos do Sort Play em execução.

Para completar a separação, foram implementados uma inicialização própria, um componente de coluna independente, a integração com o menu nativo **Colunas** e um layout que reserva espaço para o novo campo. A convivência com o Sort Play 2 também orientou essas adaptações: o Genre4all pode ser instalado junto dele, inclusive quando suas colunas extras estão ativas.

O resultado mantém o escopo do pedido original: **mostrar gêneros e estilos por faixa**. Recursos de ordenação, criação de playlists, downloads e outras ferramentas do Sort Play 2 ficaram fora do projeto. O arquivo `Genre4all.js` foi preparado primeiro para teste manual; a documentação e os fontes acompanham esta versão para permitir revisão e manutenção.

## O que a extensão oferece

- Uma coluna **Gênero**, ativada por padrão, antes da duração.
- Opção **Gênero** no menu nativo **Colunas**, aberto pela seta de seleção de detalhes da lista de faixas. A escolha de exibição é lembrada.
- Gêneros em etiquetas com cores estáveis, rolagem horizontal e botão `⋯` para ver todos os nomes e atualizar a faixa.
- Nenhum ícone adicional na barra do Sort Play. O ícone e as ações dele continuam pertencendo a ele.
- Banco IndexedDB `Genre4allDB`, configurações e CSS exclusivos. Não lê nem escreve no cache ou nas preferências do Sort Play.
- Catálogo de validação incorporado; nenhuma importação remota, chave de API ou processo auxiliar.

## Como funciona

Ao abrir uma lista de faixas, o Genre4all identifica a URI de cada música e adiciona a coluna. Para as linhas visíveis, consulta os conceitos associados à faixa pelo serviço interno `MetadataService` do Spotify. Os resultados passam pelas regras de validação e pelo catálogo de nomes antes de aparecerem como etiquetas.

O serviço mantém um cache próprio, compartilha consultas repetidas e limita o trabalho simultâneo. Quando o Spotify reutiliza uma linha para mostrar outra música, a identidade da faixa é conferida antes de preencher a célula, para evitar que uma resposta antiga seja exibida na música seguinte. O botão `⋯` abre os detalhes, a fonte dos dados e a atualização manual daquela faixa.

| Arquivo | Responsabilidade |
| --- | --- |
| `Genre4all.js` | Arquivo único para instalar no Spicetify; gerado a partir dos fontes. |
| `src/genre-service.js` | Resolução de gêneros, cache, concorrência e cancelamento. |
| `src/genre-transport.js` | Acesso ao MetadataService e armazenamento IndexedDB próprio. |
| `src/genre-column.js` | Etiquetas, estados de carregamento e janela de detalhes. |
| `src/genre-catalog.js` | Aliases, famílias de gêneros, nomes canônicos e validação. |
| `src/runtime.js` | Inicialização independente, identificação das faixas, menu e layout. |
| `scripts/build.cjs` | Geração reproduzível do arquivo instalável. |
| `scripts/verify-provenance.cjs` | Confere os hashes dos auxiliares originais de teste. |
| `tests/` | Testes do serviço, catálogo e integração em navegador. |
| `tests/fixtures/sort-play-2/` | Trechos originais fixados em um commit para reproduzir a convivência. |
| `docs/PROVENANCE.json` | Origem e hashes SHA-256 dos arquivos originais. |

## Instalação para testar no Windows

1. Baixe **Genre4all.js**. Preserve o nome e a extensão `.js`.
2. Copie para a pasta `Extensions` da configuração do Spicetify. Normalmente: `%APPDATA%\spicetify\Extensions`. Se a sua instalação usa outra pasta, `spicetify -c` mostra o caminho do arquivo de configuração; `Extensions` fica ao lado desse arquivo.
3. No PowerShell ou terminal, execute:

```powershell
spicetify config extensions Genre4all.js
spicetify apply
```

O comando de configuração adiciona a extensão à lista existente. Mantenha o Sort Play 2 na configuração se quiser testar as duas juntas.

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

Os dados vêm do `MetadataService` interno do Spotify, por URI exata da faixa. O catálogo, os aliases e as regras de validação foram extraídos do Sort Play 2 sob licença MIT. Conceitos de humor, países, valores numéricos e rótulos com confiança muito baixa são filtrados. A extensão não substitui uma faixa por outra nem usa os gêneros do artista como se fossem da faixa.

Algumas faixas não possuem esses metadados: nesse caso aparece **Sem gêneros**. Arquivos locais aparecem como **Indisponível**. O Spotify pode alterar suas APIs e a estrutura do menu; a versão instalada na máquina do usuário precisa ser validada. Em caso de serviço indisponível ou falha, `⋯` mostra o diagnóstico e permite tentar novamente.

### Validação feita

- 16 testes de catálogo, decodificação, cache, cancelamento e concorrência.
- Integração em Chromium com o transporte Spotify simulado e o **arquivo final completo**.
- Menu com opção marcada por padrão, ocultar/reativar, cache, atualização manual, janela estreita, identidade de linhas reutilizadas, estados vazios/erro/local, contêineres aninhados, persistência, carregamento repetido e limpeza.
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

Os testes de navegador usam Playwright: instale Chromium com `npx playwright install chromium`, se necessário. Neste ambiente de desenvolvimento, a integração também foi executada com Chromium disponível em `/usr/bin/chromium`. Os auxiliares originais do Sort Play 2 estão incluídos em `tests/fixtures/sort-play-2/`, portanto o teste de convivência não exige outro checkout. Para investigar outra versão, `SORT_PLAY_SOURCE` pode apontar para um checkout externo. Essa opção existe somente nos testes.

O servidor HTTP em `127.0.0.1` criado pelo teste serve a página simulada do Spotify durante a execução automatizada. Ele não faz parte da extensão e não precisa ser iniciado para usar o Genre4all.

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

No renderizador, o botão de configuração foi direcionado à janela própria de aparência. Também foi ajustado o encerramento de tarefas abortadas para permitir que uma célula válida volte à fila, em vez de permanecer no estado de carregamento.

### 3. Extração do catálogo e das regras

O arquivo `genre-catalog.js` reúne os aliases, famílias de gêneros, mapeamentos de países, conceitos excluídos, nomes canônicos e a validação usados na base. Os nomes do arquivo `assets/genre_playlist_ids.json` foram incorporados; seus identificadores de playlists não eram necessários à exibição e não foram incluídos.

O formato resultante mantém a distinção entre `style`, usado para o nome específico ou subgênero, e `genre`, usado para as famílias associadas. Quando um mesmo nome aparece nas duas categorias, o serviço consolida a etiqueta e registra as categorias correspondentes. Nomes diferentes, como `Electro` e `Electro House`, permanecem separados.

O catálogo fica dentro do arquivo instalável. O Spotify continua sendo consultado para obter os conceitos de cada faixa; o catálogo local serve para validar e apresentar esses conceitos, não para inventar gêneros para músicas sem dados.

### 4. Inicialização independente

O novo `runtime.js` espera a disponibilidade de `Spicetify.Platform`, cria o armazenamento próprio, monta o serviço e conecta o renderizador às listas de faixas.

A descoberta do `MetadataService` e a leitura da URI foram adaptadas das funções do monólito. O Genre4all procura a classe de serviço nos módulos do cliente Spotify e usa um transporte disponível em `Spicetify.Platform`. Essa é uma dependência do Spotify e do Spicetify; não há chamada a uma instância do Sort Play.

O bundle é envolvido em uma função própria. A interface global de diagnóstico é `Genre4all`. Se o arquivo for carregado novamente, a instância anterior é encerrada antes de iniciar a seguinte, evitando uma segunda coluna e observadores duplicados.

### 5. Integração com o menu de colunas

O Genre4all observa a criação dos menus e identifica o menu de detalhes pela estrutura de itens selecionáveis e por rótulos de colunas conhecidos, incluindo os nomes em português e inglês utilizados no código. Quando reconhece esse menu, acrescenta um único item **Gênero**, com marcação correspondente à preferência atual.

O clique nesse item mostra ou oculta a coluna sem alterar as preferências das outras extensões. A navegação por teclado inclui as setas e as teclas Home/End. O item é inserido quando o menu existe; não é necessário manter um menu próprio aberto ou adicionar um novo botão à barra do Sort Play.

Essa identificação depende da estrutura e dos rótulos da interface. Mudanças no Spotify ou outras traduções podem exigir uma atualização dos seletores e das regras de reconhecimento.

### 6. Componente e layout próprios

Cada célula usa o elemento `genre4all-column`. Sua função acessível de `columnheader` ou `gridcell` é definida com `ElementInternals`, sem adicionar esses atributos `role` ao elemento no DOM comum. Isso evita que os seletores de colunas do Sort Play 2 o tratem como uma coluna nativa ou um de seus campos extras.

O layout identifica as células existentes, mede o grid sem aplicar temporariamente suas próprias regras e acrescenta uma faixa de **176 px** antes da duração. As posições adicionais ficam em propriedades com prefixo `--g4a-`, separadas das propriedades de layout do Sort Play. Quando não há layout nativo do Sort Play ativo, o título pode ceder espaço até o limite de 140 px; se a lista continuar maior que a área disponível, a rolagem horizontal permite alcançar as colunas.

O código também trata listas cujas células ficam dentro de um contêiner intermediário. A coluna só é montada em linhas com grid reconhecido e identificação de faixa, ou em seus cabeçalhos. Não há uma tabela separada de músicas mantida pelo Genre4all.

### 7. Correções encontradas durante a integração

O primeiro teste do menu mostrou que `textContent` pode concatenar rótulos vizinhos sem espaços. O reconhecimento foi ajustado para esse caso, mantendo a verificação da estrutura do menu.

O teste em janela estreita encontrou regras de CSS do layout original com prioridade suficiente para ocultar a área adicional. Os seletores próprios do Genre4all foram ajustados para reservar a faixa da coluna e permitir rolagem mesmo quando o CSS do Sort Play é carregado depois.

A verificação de acessibilidade da nova coluna foi feita pela árvore de acessibilidade do Chromium, porque o papel definido em `ElementInternals` não aparece nos seletores DOM usados por outras extensões. Assim, o teste confere a semântica acessível sem abrir mão do isolamento desejado.

### 8. Distribuição e documentação

`scripts/build.cjs` concatena somente os cinco módulos listados em seu código, preserva a licença MIT no cabeçalho, remove as exportações CommonJS usadas pelos testes e produz uma única IIFE em `Genre4all.js`.

O arquivo `.js` foi entregue primeiro para teste manual, antes da publicação solicitada. A versão permanece identificada como `0.1.0-test`, pois os resultados registrados são de testes automatizados e não estabelecem compatibilidade universal com o cliente Spotify.

Os auxiliares originais necessários aos testes foram incluídos depois em `tests/fixtures/sort-play-2/`, com commit de origem, licença e hashes. Isso permite reproduzir a verificação sem instalar o Sort Play ou baixar seu monólito inteiro.

## Detalhes dos módulos

### Serviço: identidade, resultados e cache

`Genre4allGenres.identityFor()` forma uma identidade a partir da URI e dos metadados disponíveis, incluindo título, artistas, duração, álbum, ISRC e indicação de versão. O caminho ativo de consulta utiliza a URI exata do catálogo Spotify. Remixes e edições não são resolvidos por busca aproximada nesta extensão.

`resolve()` consulta o cache e compartilha uma operação em andamento entre consumidores da mesma identidade. Cada consumidor tem seu próprio cancelamento; a operação compartilhada só é abortada quando o último consumidor deixa de utilizá-la. Mudanças de configuração incrementam uma revisão e invalidam resoluções incompatíveis.

O serviço mantém estados explícitos e resultados com etiquetas, fonte, identificação do registro, horários de consulta e expiração. Recursos auxiliares herdados do módulo, como comparação de gravações e contratos de provedores, permanecem no fonte, mas o único provedor habilitado por esta versão é `spotify`.

| Parâmetro | Valor nesta versão |
| --- | --- |
| Provedor | `spotify` |
| Validade do cache | 1 hora |
| Limite de entradas de cache do provedor | 500 |
| Limite de resoluções em memória | 500 |
| Espaçamento mínimo entre consultas no limitador | 25 ms |
| Limite da fila do serviço Spotify | 128 |
| Tarefas simultâneas iniciadas pela apresentação | 4 |
| Margem de pré-carregamento da área visível | 56 px |

Esses valores são limites internos, não uma promessa de vazão da API. Erros não são apresentados como resultados bem-sucedidos e vazios. A expiração pode mostrar **Gêneros expirados**; o usuário pode solicitar nova consulta nos detalhes.

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

A comunicação utiliza a sessão já aberta do Spotify por meio do cliente interno. Não há formulário de token, servidor de gêneros do Genre4all ou carregamento de código remoto.

### Apresentação e proteção de linhas reutilizadas

`Genre4allColumn.createController()` acompanha as células e sua visibilidade. Antes de aplicar um resultado, confere se a célula ainda existe, se continua na mesma linha, se a URI e a identidade são as mesmas, se o contexto não mudou, se a coluna segue habilitada e se a revisão do serviço ainda corresponde à tarefa.

Essa verificação é necessária porque a lista virtualizada do Spotify pode reutilizar um mesmo elemento DOM para outra música durante a rolagem. Uma resposta antiga não deve aparecer na faixa que ocupou essa posição depois.

As etiquetas são criadas com texto, sem interpretar o nome do gênero como HTML. A cor é derivada do nome normalizado, mantendo uma associação estável. A célula oferece rolagem horizontal, foco de teclado e abertura de detalhes. O link da fonte é restrito ao domínio Spotify esperado.

### Observação e ciclo de vida

O runtime usa `MutationObserver` para mudanças na lista e nos menus, `ResizeObserver` quando disponível para mudanças de tamanho e a navegação de `Spicetify.Platform.History` para trocas de página. As atualizações são agrupadas em `requestAnimationFrame`.

Há também uma rechecagem a cada 1,5 segundo enquanto o documento está visível. Ela cobre situações em que o React muda os dados associados à linha sem uma alteração DOM observável. A descoberta do cliente de metadados é limitada para evitar varrer os módulos continuamente.

Ao encerrar a extensão, o código cancela eventos, temporizadores e observadores próprios, remove suas células e estilos, fecha a apresentação e o banco e descarta a interface global da instância. A definição de custom element registrada no navegador permanece até o documento ser descartado; recarregar a extensão reutiliza essa definição.

## Dados locais e preferências

| Local | Conteúdo |
| --- | --- |
| `localStorage`, chave `genre4all-visible-v1` | Se a coluna está visível. Na ausência de escolha, começa visível. |
| IndexedDB `Genre4allDB`, área `settings` | Exibição de gêneros principais, estilos e cores. |
| IndexedDB `Genre4allDB`, área `cache` | Resultados e expiração das consultas por faixa. |
| Memória da instância | Fila, consumidores, células, tarefas e cache temporário. |

Se o armazenamento persistente falhar, o runtime oferece armazenamento em memória para a sessão. Nesse caso, o cache e as preferências que dependem do banco podem não sobreviver à reinicialização. Ocultar a coluna não apaga o cache. Os dados e preferências do Sort Play 2 não são migrados nem compartilhados.

## Arquivos auxiliares do projeto original

Os seguintes arquivos foram incluídos para que os testes de convivência usem código original, e não uma reimplementação simplificada de suas decisões de layout:

| Auxiliar em `tests/fixtures/sort-play-2/` | Motivo da inclusão |
| --- | --- |
| `src/native-layout.js` | Criar e redimensionar o layout original das colunas durante o teste. |
| `src/genre-service.js` | Executar o serviço original no cenário com dois renderizadores de gênero. |
| `src/genre-column.js` | Conferir a coexistência das células e dos estilos originais. |
| `tracklist-structure.js` | Executar a função original `updateTracklistStructure`, que adiciona e remove os campos extras. |
| `LICENSE` | Preservar a licença que acompanha as cópias. |

Os três módulos e a licença são cópias integrais. A função de estrutura foi extraída sem alterações do monólito; o teste fornece o contexto de execução de que ela precisa. [PROVENANCE.json](docs/PROVENANCE.json) registra os hashes dos auxiliares e dos arquivos de origem dos módulos adaptados e do catálogo.

**Esses auxiliares não entram em `Genre4all.js` e não são necessários para instalar ou executar a extensão.** O build tem uma lista explícita de fontes e não percorre a pasta de fixtures. Não foram incluídos capas, áudios, recursos de downloads ou o restante do monólito, pois eles não auxiliam esta funcionalidade nem seus testes.

## O que os testes verificam

Os 16 testes unitários cobrem validação de conceitos, aliases, famílias, conservação de nomes distintos, decodificação, interpretação do transporte, resoluções sem título/artista, desativação da fonte, compartilhamento de consultas, cancelamento por consumidor, fila limitada, invalidação e atualização de cache.

O teste de integração abre o arquivo final no Chromium e fornece uma interface Spotify simulada. Os cenários exercitados incluem:

1. Coluna independente com gêneros válidos e exclusão de humor/país/confiança baixa.
2. Semântica de cabeçalho na árvore de acessibilidade e altura estável da linha.
3. Item nativo **Gênero** marcado, ocultação, reativação e reutilização do cache.
4. Detalhes e atualização manual com nova consulta.
5. Funções originais adicionando zero, uma e duas colunas extras, sem sobreposição geométrica.
6. Carregamento do Genre4all antes e depois do layout original.
7. Ação do cabeçalho original preservada e renderizadores de gênero das duas extensões ativos ao mesmo tempo.
8. Rolagem até a coluna em janela estreita.
9. Resposta atrasada de uma música cuja linha passou a representar outra.
10. Estados vazio, erro e arquivo local indisponível.
11. Células em contêiner intermediário, recarregamento sem duplicação, preferência persistida e limpeza final.

`test:provenance` verifica separadamente a integridade dos cinco arquivos auxiliares originais. Isso identifica alterações nas fixtures; não certifica compatibilidade com versões futuras do Sort Play ou do Spotify.

Os testes automatizados passaram no ambiente de desenvolvimento. A integração usa dados simulados e trechos originais delimitados; ela não executa o Spotify Desktop real nem todas as funcionalidades do monólito Sort Play 2. O teste manual recomendado é instalar o `.js`, abrir listas reais, alternar **Gênero**, rolar as faixas e repetir com as colunas extras do Sort Play ligadas.

## Manutenção e diagnóstico

Faça alterações em `src/` e execute `npm run build` para atualizar a distribuição. `npm run check` compara o arquivo gerado com os fontes e verifica sua sintaxe. Não edite somente `Genre4all.js`, pois a próxima compilação substituirá essa edição.

No console do Spotify, os comandos abaixo ajudam a identificar o estado da instância:

```js
Genre4all.diagnostics();      // Versão, contexto, células e estado do serviço.
Genre4all.visible;            // Preferência atual de exibição.
Genre4all.sync();             // Agenda nova verificação das listas e menus.
Genre4all.setVisible(false);  // Oculta a coluna e salva a preferência.
Genre4all.setVisible(true);   // Reativa a coluna.
Genre4all.close();            // Encerra a instância até o próximo carregamento.
```

Se o menu não ganhar a opção **Gênero**, registre a versão do Spotify/Spicetify e a estrutura do menu que mudou. Se os detalhes indicarem `SPOTIFY_METADATA_UNAVAILABLE` ou `SPOTIFY_EXTENSION_MISSING`, a investigação deve começar pela disponibilidade do serviço interno. `SPOTIFY_TIMEOUT` indica que a consulta não terminou no prazo; a ação de atualização permite tentar outra vez.

Uma lista vazia não comprova falta de gênero musical na obra: significa que esta consulta, com a fonte e os filtros desta versão, não entregou etiquetas utilizáveis. A extensão não utiliza gêneros de artista como substitutos silenciosos para os da gravação.
