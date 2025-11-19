# JurisTCU API

Sistema inteligente para análise e categorização de casos concretos baseado em acórdãos do Tribunal de Contas da União (TCU), utilizando múltiplos modelos de IA.

## 📋 Sobre o Projeto

A JurisTCU API utiliza inteligência artificial para analisar casos concretos e encontrar acórdãos relevantes do TCU, categorizando-os automaticamente segundo critérios específicos de áreas como Licitações, Gestão de Pessoal, Convênios e outras.

### Características Principais

- 🤖 **Múltiplos Modelos de IA**: Suporta Gemini, Claude e OpenAI com fallback automático
- 📊 **Análise Completa**: Processa todos os acórdãos do banco de dados
- 🎯 **Categorização Inteligente**: Sistema de critérios para 5 categorias principais
- 🔄 **Fallback Automático**: Troca automaticamente entre IAs quando uma falha ou excede quota
- 📈 **Resultados Relevantes**: Retorna apenas acórdãos com 60%+ de aderência aos critérios
- 🔒 **Autenticação Segura**: Sistema de API Keys para proteção dos endpoints

## 🏗️ Arquitetura

```
┌─────────────┐
│   Cliente   │
└──────┬──────┘
       │ HTTP POST
       ▼
┌─────────────────────────────────┐
│      JurisTCU API               │
│  ┌──────────────────────────┐   │
│  │   Sistema de Fallback    │   │
│  │   Gemini → Claude → GPT  │   │
│  └──────────────────────────┘   │
└────────┬────────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌─────────┐ ┌──────────────┐
│Supabase │ │  Modelos IA  │
│  (DB)   │ │ (3 opções)   │
└─────────┘ └──────────────┘
```

## 🚀 Instalação

### Pré-requisitos

- Node.js 18+ 
- npm ou yarn
- Conta no Supabase
- Pelo menos uma chave de IA (Gemini, Claude ou OpenAI)

### Passo a Passo

1. **Clone o repositório**

```bash
git clone https://github.com/iammarcelomonteiro/juristcu.git
cd juristcu
```

2. **Instale as dependências**

```bash
npm install
```

3. **Configure as variáveis de ambiente**

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas credenciais (veja seção de Configuração).

4. **Inicie o servidor**

```bash
npm start
```

O servidor estará disponível em `http://localhost:3000`

## ⚙️ Configuração

### Variáveis de Ambiente Obrigatórias

```env
# Servidor
PORT=3000
MODO_DEBUG=true

# Autenticação (deve começar com "tcu_")
API_KEY=tcu_sua_chave_secreta_aqui

# Supabase
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_KEY=sua_chave_supabase
```

### Chaves de IA (pelo menos uma é obrigatória)

```env
# Gemini (prioridade 1 - recomendado)
GEMINI_KEYS=chave1,chave2,chave3

# Claude (prioridade 2)
ANTHROPIC_API_KEY=sk-ant-api03-...
VERSAO_CLAUDE=sonnet-4.5

# OpenAI (prioridade 3)
OPENAI_API_KEY=sk-proj-...
VERSAO_CHATGPT=gpt-4o
```

### Estrutura do Banco de Dados

A tabela `acordaos` no Supabase deve ter os seguintes campos:

- `id` - UUID (PK)
- `numero_acordao` - Integer
- `ano_acordao` - Integer
- `titulo` - Text
- `sumario` - Text
- `texto_pdf` - Text (extraído do PDF)
- `data_sessao` - Date
- `relator` - Text
- `colegiado` - Text
- `url_acordao` - Text

## 📡 Endpoints

### `GET /api/v1/health` (público)

Verifica o status da API.

```bash
curl http://localhost:3000/api/v1/health
```

**Resposta:**
```json
{
  "status": "online",
  "versao": "1.0.0",
  "servicos": {
    "supabase": "conectado",
    "gemini": "2 chave(s)",
    "claude": "configurado",
    "openai": "configurado"
  },
  "timestamp": "2025-11-15T10:30:00.000Z"
}
```

### `GET /api/v1/info` (autenticado)

Informações sobre a API e categorias disponíveis.

```bash
curl -H "X-API-Key: tcu_sua_chave" http://localhost:3000/api/v1/info
```

### `GET /api/v1/estatisticas` (autenticado)

Estatísticas do banco de dados.

```bash
curl -H "X-API-Key: tcu_sua_chave" http://localhost:3000/api/v1/estatisticas
```

**Resposta:**
```json
{
  "sucesso": true,
  "total_acordaos": 1500,
  "acordaos_processaveis": 1450,
  "acordaos_sem_texto": 50,
  "percentual_processavel": "96.67%"
}
```

### `POST /api/v1/analisar-caso` (autenticado)

Analisa um caso concreto e retorna acórdãos relevantes.

```bash
curl -X POST http://localhost:3000/api/v1/analisar-caso \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tcu_sua_chave" \
  -d '{
    "caso_concreto": "Município realizou contratação direta sem comprovação dos requisitos legais para dispensa de licitação. O objeto contratado poderia ter sido licitado. Houve superfaturamento de 30% em relação ao preço de mercado.",
    "max_resultados": 10
  }'
```

**Parâmetros:**

- `caso_concreto` (string, obrigatório): Descrição do caso (mínimo 50 caracteres)
- `max_resultados` (number, opcional): Quantidade de acórdãos a retornar (padrão: 10, máximo: 100)
- `max_acordaos` (number, opcional): Limite de acórdãos a processar (padrão: todos)

**Resposta:**
```json
{
  "sucesso": true,
  "caso_concreto": "Município realizou contratação direta...",
  "total_acordaos_banco": 1450,
  "acordaos_processados": 1450,
  "acordaos_relevantes_encontrados": 45,
  "acordaos_retornados": 10,
  "tempo_processamento_segundos": 127.5,
  "resultados": [
    {
      "acordao": {
        "id": "uuid-here",
        "numero": 1234,
        "ano": 2024,
        "titulo": "Título do Acórdão",
        "data_sessao": "2024-03-15",
        "relator": "Ministro Fulano",
        "colegiado": "Plenário",
        "url_acordao": "https://..."
      },
      "categorias": [
        {
          "categoria": "Licitações e Contratos",
          "subcategoria": "Dispensa ou inexigibilidade indevida",
          "totalCriterios": 4,
          "criteriosAtendidos": 4,
          "percentualAtendimento": 100,
          "criterios": [
            {
              "numero": 1,
              "texto": "O caso refere-se a uma contratação direta",
              "atende": true,
              "justificativa": "Caso descreve contratação sem licitação"
            }
          ]
        }
      ]
    }
  ],
  "estatisticas": {
    "gemini_usado": true,
    "claude_usado": false,
    "openai_usado": false,
    "quota_claude_excedida": false,
    "quota_openai_excedida": false,
    "progresso_percentual": "100.00"
  }
}
```

## 🎯 Categorias de Análise

A API categoriza casos em 5 áreas principais:

### 1. Licitações e Contratos
- Irregularidades no processo licitatório
- Dispensa ou inexigibilidade indevida
- Execução contratual e superfaturamento

### 2. Gestão de Pessoal
- Admissão irregular de servidores (incluindo nepotismo)
- Concessão irregular de aposentadorias e pensões
- Acumulação indevida de cargos ou pagamentos irregulares

### 3. Prestação de Contas e Tomada de Contas Especial
- Omissão ou não prestação de contas
- Prestação de contas irregular ou incompleta

### 4. Convênios e Transferências Voluntárias
- Execução não realizada ou deficiente do objeto conveniado
- Desvio de finalidade ou uso indevido dos recursos
- Prestação de contas do convênio irregular

### 5. Gestão Administrativa e Controle Interno
- Falhas de controles internos e auditoria
- Descumprimento de normas e deveres administrativos
- Uso inapropriado de recursos públicos

## 🤖 Sistema de Fallback de IAs

A API implementa um sistema inteligente de fallback:

1. **Gemini (Prioridade 1)**: Processamento inicial com todas as chaves configuradas
2. **Claude (Prioridade 2)**: Ativado automaticamente se Gemini falhar
3. **OpenAI (Prioridade 3)**: Última alternativa se Claude também falhar

### Comportamento de Erros

- **Gemini**: Ao falhar uma chave, tenta a próxima. Se todas falharem, muda para Claude
- **Claude**: Ao exceder quota ou falhar, muda permanentemente para OpenAI
- **OpenAI**: Ao exceder quota, retorna resultados parciais processados até o momento

## 🔒 Autenticação

A API requer autenticação em todos os endpoints exceto `/health`.

### Formas de autenticar:

**Header X-API-Key:**
```bash
curl -H "X-API-Key: tcu_sua_chave" https://api.example.com/endpoint
```

**Header Authorization Bearer:**
```bash
curl -H "Authorization: Bearer tcu_sua_chave" https://api.example.com/endpoint
```

### Gerando uma API Key segura

Sua API Key deve:
- Começar com `tcu_`
- Ter pelo menos 20 caracteres após o prefixo
- Ser mantida em segredo

Exemplo de geração:
```bash
echo "tcu_$(openssl rand -hex 16)"
```

## 📊 Performance

- **Processamento**: ~0.5s por critério (com pausa entre avaliações)
- **Acórdãos processados**: Todos os disponíveis no banco
- **Resultados retornados**: Top N mais relevantes (≥60% de aderência)
- **Timeout**: Configurável (recomendado: 300s para grandes volumes)

## 🐛 Debug e Logs

Ative o modo debug no `.env`:

```env
MODO_DEBUG=true
```

Logs incluem:
- Autenticação e validações
- Progresso de processamento
- Trocas de IA (fallback)
- Erros e warnings
- Estatísticas finais

## 📝 Exemplos de Uso

### Exemplo 1: Análise de Licitação

```javascript
const response = await fetch('http://localhost:3000/api/v1/analisar-caso', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'tcu_sua_chave'
  },
  body: JSON.stringify({
    caso_concreto: 'Prefeitura realizou pregão eletrônico onde apenas uma empresa participou. Indícios de direcionamento no edital com especificações muito restritivas. Valor 40% acima do mercado.',
    max_resultados: 5
  })
});

const data = await response.json();
console.log(data.resultados);
```

### Exemplo 2: Análise de Convênio

```bash
curl -X POST http://localhost:3000/api/v1/analisar-caso \
  -H "Content-Type: application/json" \
  -H "X-API-Key: tcu_sua_chave" \
  -d '{
    "caso_concreto": "Convênio federal para construção de escola. Recursos utilizados para compra de veículos. Convenente não apresentou prestação de contas no prazo. Obra não foi iniciada.",
    "max_resultados": 15
  }'
```

## 🚨 Tratamento de Erros

### Códigos de Status HTTP

- `200` - Sucesso
- `400` - Requisição inválida (campos obrigatórios, validações)
- `401` - API Key não fornecida
- `403` - API Key inválida
- `404` - Endpoint não encontrado
- `500` - Erro interno do servidor
- `503` - Serviços de IA indisponíveis

### Exemplo de Erro

```json
{
  "erro": "Parâmetro inválido",
  "mensagem": "O campo 'caso_concreto' é obrigatório e deve ser uma string"
}
```

## 🛠️ Tecnologias Utilizadas

- **Node.js** - Runtime JavaScript
- **Express** - Framework web
- **Supabase** - Banco de dados PostgreSQL
- **Google Gemini** - Modelo de IA (principal)
- **Anthropic Claude** - Modelo de IA (fallback)
- **OpenAI GPT** - Modelo de IA (último recurso)

## 📦 Dependências

```json
{
  "express": "^4.18.2",
  "@supabase/supabase-js": "^2.39.0",
  "dotenv": "^16.3.1",
  "@google/generative-ai": "^0.1.3",
  "@anthropic-ai/sdk": "^0.27.0",
  "openai": "^4.20.0"
}
```

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/MinhaFeature`)
3. Commit suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

## 👤 Autor

**Marcelo Monteiro**
- GitHub: [@iammarcelomonteiro](https://github.com/iammarcelomonteiro)

## 📞 Suporte

Para questões e suporte:
- Abra uma [issue](https://github.com/iammarcelomonteiro/juristcu/issues)
- Entre em contato através do GitHub

---

**JurisTCU API** - Análise inteligente de acórdãos do TCU com IA 🚀