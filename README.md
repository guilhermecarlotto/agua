# 💧 Gota — Água, Chimarrão e Sono

Diário pessoal (PWA, HTML/CSS/JS puro, sem build, sem backend, sem dependências) para registrar **água, café, chimarrão e outras bebidas**, a **noite de sono** (dados do Huawei Health digitados à mão) e as **idas ao banheiro na madrugada** — e comparar tudo isso para enxergar padrões.

> É uma ferramenta de **observação pessoal**. Não faz diagnóstico, não estima cafeína, não recomenda restringir água e não afirma causa e efeito: só mostra associações entre os seus registros.

## Três áreas (navegação inferior)

| Aba | O que tem |
|---|---|
| 💧 **Água** | Botões de 1 toque (+250 ml, +500 ml, +1 L, +1,7 L) com as opções discretas **😴 ao acordar** e **💊 vitaminas** logo abaixo; **chimarrão por cuias**; café com botões rápidos configuráveis; outras bebidas / registro detalhado (data e hora editáveis), resumo do dia (água, total de líquidos, café, chimarrão, outras, última ingestão, período da noite), meta de água, sequência, gráfico de 14 dias, histórico com navegação por dia e edição. |
| 🌙 **Sono** | Botão **🚻 Fui ao banheiro agora**, resumo da última noite, formulário da noite (dormi/acordei, despertares individuais ou só totais, nota 0–10, avaliação, observações), idas ao banheiro da noite com associação aos despertares, lista de noites. |
| 📊 **Análise** | Período (7/14/30 dias, tudo), última noite, 8 comparações em gráficos de dispersão (1 ponto = 1 noite, toque para abrir a noite), café e chimarrão por dia, padrões observados (com n e diferença entre médias), tabela comparativa com detalhe por noite. |

O botão 🚻 também fica **no cabeçalho de todas as telas**. Entre 22h e 6h o app reduz o brilho, desliga animações/confete e abre direto na aba Sono.

**Visual animado (desde a 2.2.0):** fundo com manchas de cor em movimento, cartões de vidro, esfera de água com ondas e anel de progresso, botões com brilho, gotinhas/emoji ao registrar, barra inferior flutuante com indicador deslizante e botão 🚻 flutuante (nas abas Água e Análise). Respeita "Reduzir movimento" do iOS.

**Modo noturno (tela mínima):** troca a paleta colorida por fundo **preto puro (#000)** com textos, bordas, gráficos e ícones em vermelho escuro, sem animações — pensado para telas OLED (pixel preto = apagado) e para registrar a ida ao banheiro de madrugada com o mínimo de luz.
- **Automático:** liga sozinho às **22h** e desliga às **6h**.
- **Manual:** a chave em ⚙️ Ajustes liga/desliga a qualquer hora. A escolha manual vale até a próxima virada (22h ou 6h) e depois volta ao automático; "voltar ao automático agora" cancela antes.
- O aviso de que o seletor de hora/data nativo do iOS é desenhado pelo sistema e pode continuar claro continua valendo. A preferência fica só no aparelho (não entra no backup).

## Como o registro foi mantido simples

- Água, café e chimarrão: **um toque** registra com data e hora de agora. A confirmação é um aviso discreto com **Desfazer**.
- Excluir também tem **Desfazer** (sem janelas de confirmação).
- Toque em qualquer registro do histórico para corrigir quantidade, tipo, dia e horário.
- Só três campos são obrigatórios na noite: data, hora de dormir e hora de acordar.

## Regras de cálculo importantes

- **Noites atravessam a meia-noite.** Uma noite é identificada pela data em que começa ("Noite de 18 para 19"). Dormir antes das 12h é tratado como "depois da meia-noite" dessa noite. Internamente tudo é "minutos absolutos" de relógio local, sem fuso/UTC.
- **Ida ao banheiro** pertence à noite pelo horário: antes das 12h = madrugada da noite anterior. Se a noite tem registro de sono, só contam as idas **entre dormir e acordar**.
- **Sem dupla contagem:** o despertar marcado com 🚻 e a ida registrada pelo botão no mesmo horário (±10 min) são tratados como o mesmo evento (o app *sugere* o vínculo e você confirma/corrige). Despertar marcado 🚻 sem registro de botão conta como uma ida. Totais agregados do relógio só valem se não houver despertares individuais.
- **Janelas antes de dormir** (2, 3 e 4 h), separadas em água / café / chimarrão / outras / total, mais última ingestão e intervalo até dormir.
- **Chimarrão por cuias:** informe uma vez o **tamanho da cuia** (ml; fica gravado) e toque em **🧉 + cuia** a cada cuia tomada. A 1ª cuia cria a sessão e o horário dela é o **início**; cada nova cuia soma o volume no **mesmo registro** e atualiza o **fim** para o horário da última. O contador mostra cuias e ml da sessão em andamento e o total do dia. A sessão termina pelo botão **Encerrar** ou sozinha quando passam **3 h sem nova cuia** (a próxima cuia abre outra sessão). "Desfazer" reverte o último toque. Para lançar um volume avulso, use "Outras bebidas / registro detalhado" (tipo Chimarrão).
- **Chimarrão em sessão** (início–fim, ex.: 800 ml das 16h às 18h) é **um único registro**; editar não duplica. O volume **não é distribuído** entre início e fim: em janelas que a sessão cruza só em parte, o app mostra "0 (até 800, incerto)". Nas análises, pontos incertos aparecem vazados e noites ambíguas ficam fora das comparações em grupo.
- **"Sem dados" ≠ zero.** Noite sem bebidas com horário no dia, sem informação de despertares ou sem nota mostra "Sem dados" e fica fora dos gráficos/médias daquele indicador. "Não acordei" é um dado explícito (zero).
- **Padrões** só aparecem com ≥ 3 noites em cada grupo e ≥ 8 no total, sempre com n e diferença das médias. Não há teste estatístico: poucas noites variam por acaso.
- Meta e sequência usam **somente água**. Café, chimarrão e outras bebidas entram no "Total de líquidos".

## Seus dados antigos estão preservados

- O Gota antigo gravava em `localStorage["gota_agua_state_v1"]`. A versão nova **nunca altera nem apaga essa chave**.
- Na primeira abertura, o app lê o v1 e cria o formato novo em outra chave (`gota_state_v2`): cada lançamento vira uma bebida do tipo *água* com o mesmo valor, data, horário e marca "ao acordar"; vitaminas, meta e recorde são copiados. Lançamentos com horário `--:--` **continuam sem horário** (entram nos totais do dia, nunca em janelas de horário).
- Uma **cópia integral do v1 original** fica dentro do novo estado (`legacy.v1`) e vai junto em todo backup exportado.
- IDs dos lançamentos antigos são determinísticos: importar o backup antigo de novo **não duplica**.
- Redundância: cada gravação vai para o `localStorage` e para um espelho no IndexedDB (`gotaDB`). Se o `localStorage` sumir ou corromper, o app **lê** o espelho (a cópia corrompida é guardada, não apagada). Em Ajustes (⚙️) há "Verificar cópia interna".
- Atualizar app/Service Worker não mexe nos dados: o Service Worker só guarda os arquivos do app.

## Backup

⚙️ Ajustes (ou rodapé da aba Água): **Exportar** (JSON com tudo) e **Importar**. A importação aceita backups do Gota antigo e do novo, valida os dados (itens inválidos são ignorados e contados) e oferece **Mesclar** (acrescenta o que falta, sem apagar e sem duplicar) ou **Substituir** (guarda uma cópia do estado atual, recuperável em Ajustes).

## Estrutura de arquivos

```
agua/
├── index.html        app (interface, armazenamento, gráficos)
├── gota-core.js      NOVO — lógica pura: datas, migração, validação, cálculos, análises (testável sem navegador)
├── sw.js             service worker (network-first; cache gota-v5)
├── manifest.json     manifesto PWA
├── icon-192.png / icon-512.png
├── tests/
│   ├── core.test.js  64 testes automatizados do núcleo
│   └── run.html      roda os testes no navegador
└── README.md
```

`gota-core.js` foi separado do `index.html` só para poder testar a lógica de cálculo isoladamente; continua sem build e sem dependências.

## Publicar no GitHub Pages

1. **Antes**, exporte um backup no app antigo (⬇ exportar backup) e guarde o arquivo.
2. No repositório, substitua `index.html`, `sw.js`, `manifest.json`, `README.md` e **adicione** `gota-core.js` e a pasta `tests/` (os ícones não mudam).
3. Faça commit e push; aguarde o Pages publicar (1–2 min).

## Atualizar no iPhone

1. Abra o app instalado **com internet**. O Service Worker busca a versão nova e o app recarrega sozinho (se não, feche o app deslizando e abra de novo).
2. Confira em ⚙️ Ajustes: versão 2.2.0 e a mensagem "Histórico do Gota antigo migrado".
3. Se parecer que não atualizou, feche o app e abra de novo com internet. **Nunca** apague os dados do site/app no iPhone sem ter um backup exportado.
4. Faça um backup novo depois de conferir os dados.

## Testes

- **Automatizados (lógica):** abra `tests/run.html` num servidor local (`python -m http.server 8000`, depois `http://localhost:8000/tests/run.html`) ou rode `node tests/core.test.js`. Cobrem datas, migração do v1, janelas de 2/3/4 h, sessões de chimarrão, noites que cruzam a meia-noite, despertares (sobreposição, agregado × individual), banheiro, "Sem dados", padrões, importação/mesclagem/exportação.
- **Manuais no navegador (feitos com tela 320–390 px):** botões rápidos, edição, desfazer, fluxo completo do sono, 8 gráficos, backup/importação, recuperação do espelho, corrupção do `localStorage`, Service Worker e modo offline.
- **Dependem do iPhone/Safari (não testáveis aqui):** seletor de hora nativo do iOS, instalação na Tela de Início, comportamento do armazenamento do Safari/PWA ao longo de semanas, download do backup no iOS (abre a folha de compartilhamento), "Adicionar à Tela de Início" com o ícone novo.
