# 💧 Gota — Controle de Água Diário

App PWA standalone (HTML/CSS/JS puro, sem build, sem backend) para acompanhar seu consumo de água do dia a dia.

## Funcionalidades

- Botões rápidos **+250ml**, **+500ml**, **+1L** e campo de quantidade manual.
- Botão "desfazer último registro".
- Toggle **"ingestão ao acordar"** — quando ativado, o próximo registro é marcado como o copo de água ao acordar (aparece em azul mais claro no gráfico e com ícone 🌅 no histórico).
- Toggle **"tomei as vitaminas hoje"**.
- Campo de **meta diária** (em ml), editável a qualquer momento.
- Copo animado mostrando o progresso do dia.
- **Sequência de dias batendo a meta** (🔥) e **recorde histórico** (🏆), calculados automaticamente a partir do histórico.
- **Gráfico dos últimos 14 dias** (canvas nativo, sem dependências): cada barra é dividida em água ao acordar (azul claro, no topo) e restante do dia (azul mais escuro, embaixo), com uma linha tracejada indicando a meta.
- Histórico do dia com horário de cada registro e opção de excluir.
- Exportar/importar backup em **JSON**.
- Funciona **100% offline** (Service Worker com cache-first) e é **instalável** no iPhone/Android/desktop (PWA).
- Dados salvos em **localStorage**, com espelho automático em **IndexedDB** como redundância.

## Estrutura de arquivos

```
agua/
├── index.html      (app principal)
├── manifest.json   (PWA manifest)
├── sw.js           (service worker — cache offline)
├── icon-192.png    (ícone gota, 192x192)
├── icon-512.png    (ícone gota, 512x512)
└── README.md       (este arquivo)
```

## Como usar

### No desktop (teste rápido)
```bash
cd agua
python -m http.server 8000
# abra http://localhost:8000
```

### No iPhone (instalar como app)
1. Suba a pasta em um repositório GitHub (ou GitHub Pages) ou sirva localmente na sua rede.
2. Abra a URL no Safari.
3. Toque em "Compartilhar" → "Adicionar à Tela de Início".
4. O app abre em tela cheia, como um app nativo, e funciona offline depois do primeiro carregamento.

## Observações técnicas

- Sem dependências externas — tudo em `index.html`, `sw.js` funcionando com cache-first.
- O toggle "ao acordar" é um modo transitório: ative-o, adicione a quantidade daquele copo, e ele desliga sozinho depois do registro (assim você não esquece de desativá-lo).
- A meta e o recorde são recalculados a cada ação a partir do histórico salvo, então funcionam mesmo se você pular dias.
- Para sincronizar entre vários dispositivos (ex: iPhone + navegador), use os botões de exportar/importar backup — cada um gera/lê um `.json` com todo o histórico.
- Sincronização em nuvem (Firebase) não foi incluída nesta versão para manter o app 100% offline e sem dependências externas; pode ser adicionada depois se você quiser.
