# Validação da versão 1.14.0

Executada em 05/11/2026, no Windows, com Node 24.22.1 e Chromium via Playwright. As páginas usam dados simulados, sem conta, reprodução ou chamadas ao Spotify real.

## Resultado

- 38 testes unitários aprovados.
- Integração do bundle completo aprovada: gêneros, fornecedores, cache, pin, estados, reordenação, linhas recicladas, colunas do Sort Play, reload e limpeza.
- Suíte específica do player aprovada: pixels monocromáticos, envelope/seções, clique, arraste, teclado, controles nativos, ilha, indisponibilidade da análise, resposta atrasada, visibilidade, remontagem, largura compacta, movimento reduzido e ciclos de ativação/desativação.
- Sintaxe, bundle atualizado, cinco fixtures de proveniência e `git diff --check` conferidos.
- Capturas em 1280 × 720 e 720 × 600, com densidade 2x, inspecionadas. Entrada da ilha também inspecionada em fases intermediárias.

## Desenho e precisão

O envelope deriva dos campos de início/pico/fim de intensidade dos segmentos. O corpo integra a energia no intervalo; os picos preservam ataques. As divisões usam as seções recebidas da análise. O tooltip descreve intensidade alta/baixa/moderada e evolução crescente/decrescente, sem classificar automaticamente instrumentos ou afirmar que um trecho é um drop.

Sem análise, a linha neutra mantém seek e controles. A geração procedural antiga continua exportada por compatibilidade, mas não é usada como representação da música em reprodução.

A ilha tem 14 px de distância acima do contêiner, 24 px acima da posição anterior. Os atrasos de entrada dos cinco botões da fixture são 82, 56, 30, 68 e 94 ms. O botão central aparece primeiro. Animação usa transform e opacity, sem filtros de blur.

## Comparação de trabalho do player

Mesma fixture, máquina, navegador e tamanho; comparação com a cópia de trabalho preservada antes das alterações desta versão. Música pausada e cursor estacionado sobre a waveform durante um segundo:

| Medida | Antes | 1.14.0 |
| --- | ---: | ---: |
| Leituras de progresso em um segundo de hover parado | 112 | 1 |
| Repinturas nesse intervalo, sem mudança de progresso | 0 | 0 |
| Leituras de geometria em 60 movimentos fora do player | 61 | 0 |

Esses números medem operações na fixture, não porcentagem de CPU nem desempenho garantido em todos os computadores. A eliminação do loop contínuo e das medições globais reduz trabalho independentemente da taxa de atualização da tela. O desenho não repinta enquanto o documento está oculto. O cache mantém até 64 análises compactadas e o canvas limita a densidade a 2x.

## Reprodução

```sh
npm install
npm run build
npm run check
npm test
```

Playwright usa seu Chromium ou um Chrome/Edge instalado. Se necessário, execute `npx playwright install chromium`. Os testes interceptam `http://genre4all.test/` e entregam o HTML da fixture localmente. `tests/player.browser.cjs` gera capturas e métricas em `test-results/`, ignorado pelo Git.

## Limite desta validação

O Spotify Desktop real não foi executado nesta revisão. A disponibilidade de análise e o DOM variam com a versão do cliente; isso ainda requer conferência no Spotify instalado. Não houve alteração nos contratos de resolução dos provedores nesta revisão visual. As mudanças locais de pin, ordenação de estilos e agregação Discogs que já existiam foram preservadas e estão cobertas pelos testes.
