# Avatar + IA Generativa

Este projeto usa o sample do Azure Speech Avatar, com ajustes para:
- Iniciar a sessão automaticamente.
- Remover os botões Start Session e Speak.
- Adicionar um campo de texto para conversar com a IA e reproduzir via TTS.
- Backend Node para chamar a OpenAI com segurança.

## Como rodar
1. Configure a variável de ambiente OPENAI_API_KEY (não coloque a chave no frontend):
   - Windows PowerShell:
     - $env:OPENAI_API_KEY = "sua_chave_aqui"
2. Instale as dependências e inicie o servidor:
   - npm install
   - npm start
3. Abra http://localhost:3000/base.html no navegador.
4. Informe Region e API Key do Azure Speech e aguarde a sessão conectar.
5. Digite sua mensagem e clique em Enviar.

Notas:
- O arquivo base.html referencia ./js/basic.js e ./css/styles.css.
- O backend expõe POST /api/generate que usa OpenAI Responses API.
