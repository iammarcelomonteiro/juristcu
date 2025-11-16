// llm-runner.js
const { OpenAI } = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

// Versão do ChatGPT configurada via .env
const VERSAO_CHATGPT = process.env.VERSAO_CHATGPT || '4.1';

// Mapeia versões genéricas para nomes de modelos OpenAI atuais
const OPENAI_MODEL_MAP = {
  '3': 'gpt-3.5-turbo',
  '3.5': 'gpt-3.5-turbo',
  '4': 'gpt-4o',
  '4o': 'gpt-4o',
  '4.1': 'gpt-4-turbo',
  '4.1-mini': 'gpt-4-turbo',
  '5': 'gpt-4o',  // Fallback para gpt-4o até que GPT-5 esteja disponível
  '5-mini': 'gpt-4o-mini'
};

// Modelo Gemini padrão
const GEMINI_MODEL_DEFAULT = 'gemini-2.0-flash-exp';

// Versão do Claude configurada via .env
const VERSAO_CLAUDE = process.env.VERSAO_CLAUDE || 'sonnet-4.5';

// Mapeia versões genéricas para nomes de modelos Claude atuais
const CLAUDE_MODEL_MAP = {
  'opus-4': 'claude-opus-4-20250514',
  'opus-4.1': 'claude-opus-4.1-20250514',
  'sonnet-4': 'claude-sonnet-4-20250514',
  'sonnet-4.5': 'claude-sonnet-4-5-20250929'
};

/**
 * Executa um prompt em OpenAI (Chat Completions)
 * @param {string} prompt - O texto a ser enviado
 * @param {string} versaoChatGPT - Versão do modelo (ex: "4", "4.1", "5")
 * @param {number} temperature - Temperatura (0 a 2)
 * @param {string} apiKey - Chave da API OpenAI
 * @returns {Promise<string>} Resposta do modelo
 */
async function runOpenAI(prompt, versaoChatGPT, temperature = 0.2, apiKey) {
  const model = OPENAI_MODEL_MAP[versaoChatGPT] || OPENAI_MODEL_MAP['4.1'] || 'gpt-4o';
  
  const openai = new OpenAI({ apiKey });
  
  try {
    const res = await openai.chat.completions.create({
      model,
      temperature,
      messages: [
        { 
          role: 'system', 
          content: 'Você é um especialista em análise de acórdãos do TCU. Retorne apenas JSON válido.' 
        },
        { role: 'user', content: prompt }
      ],
      max_tokens: 500
    });
    
    return res.choices?.[0]?.message?.content?.trim() || '';
  } catch (err) {
    // Fallback para gpt-4o se o modelo escolhido não estiver disponível
    if (model !== 'gpt-4o') {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature,
        messages: [
          { 
            role: 'system', 
            content: 'Você é um especialista em análise de acórdãos do TCU. Retorne apenas JSON válido.' 
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500
      });
      return res.choices?.[0]?.message?.content?.trim() || '';
    }
    throw err;
  }
}

/**
 * Executa um prompt no Gemini
 * @param {string} prompt - O texto a ser enviado
 * @param {number} temperature - Temperatura (0 a 2)
 * @param {string} apiKey - Chave da API Gemini
 * @returns {Promise<string>} Resposta do modelo
 */
async function runGemini(prompt, temperature = 0.2, apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_DEFAULT });
  
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: 500
    }
  });
  
  return result.response.text().trim();
}

/**
 * Executa um prompt no Claude
 * @param {string} prompt - O texto a ser enviado
 * @param {string} versaoClaude - Versão do modelo (ex: "sonnet-4.5", "opus-4.1")
 * @param {number} temperature - Temperatura (0 a 1)
 * @param {string} apiKey - Chave da API Anthropic
 * @returns {Promise<string>} Resposta do modelo
 */
async function runClaude(prompt, versaoClaude, temperature = 0.2, apiKey) {
  const model = CLAUDE_MODEL_MAP[versaoClaude] || CLAUDE_MODEL_MAP['sonnet-4.5'];
  
  const anthropic = new Anthropic({ apiKey });
  
  try {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 500,
      temperature,
      system: 'Você é um especialista em análise de acórdãos do TCU. Retorne apenas JSON válido.',
      messages: [
        { role: 'user', content: prompt }
      ]
    });
    
    return message.content[0]?.text?.trim() || '';
  } catch (err) {
    // Fallback para sonnet-4.5 se o modelo escolhido não estiver disponível
    if (model !== CLAUDE_MODEL_MAP['sonnet-4.5']) {
      const message = await anthropic.messages.create({
        model: CLAUDE_MODEL_MAP['sonnet-4.5'],
        max_tokens: 500,
        temperature,
        system: 'Você é um especialista em análise de acórdãos do TCU. Retorne apenas JSON válido.',
        messages: [
          { role: 'user', content: prompt }
        ]
      });
      return message.content[0]?.text?.trim() || '';
    }
    throw err;
  }
}

/**
 * Função principal de roteamento: usa OpenAI, Gemini ou Claude
 * @param {object} params
 * @param {string} params.prompt - Texto a ser enviado ao LLM
 * @param {'openai'|'gemini'|'claude'} params.llm - Fornecedor (openai, gemini ou claude)
 * @param {number} [params.temperature] - Temperatura (0 a 2 para OpenAI/Gemini, 0 a 1 para Claude)
 * @param {string} [params.apiKey] - Chave da API específica
 * @returns {Promise<string>} Resposta do modelo
 */
async function gerarResposta({ prompt, llm, temperature = 0.2, apiKey }) {
  if (!prompt || !llm) {
    throw new Error("Parâmetros obrigatórios: prompt e llm ('openai', 'gemini' ou 'claude')");
  }
  
  if (!apiKey) {
    throw new Error('apiKey é obrigatória');
  }
  
  if (llm === 'openai') {
    return await runOpenAI(prompt, VERSAO_CHATGPT, temperature, apiKey);
  }
  
  if (llm === 'gemini') {
    return await runGemini(prompt, temperature, apiKey);
  }
  
  if (llm === 'claude') {
    // Claude usa temperatura de 0 a 1, então ajustamos se necessário
    const claudeTemp = Math.min(temperature, 1);
    return await runClaude(prompt, VERSAO_CLAUDE, claudeTemp, apiKey);
  }
  
  throw new Error("llm inválido. Use 'openai', 'gemini' ou 'claude'");
}

module.exports = {
  gerarResposta,
  VERSAO_CHATGPT,
  VERSAO_CLAUDE,
  OPENAI_MODEL_MAP,
  CLAUDE_MODEL_MAP,
  GEMINI_MODEL_DEFAULT
};