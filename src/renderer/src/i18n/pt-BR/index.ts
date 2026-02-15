import common from './common.json'
import update from './update.json'
import routes from './routes.json'
import chat from './chat.json'
import model from './model.json'
import thread from './thread.json'
import dialog from './dialog.json'
import settings from './settings.json'
import mcp from './mcp.json'
import welcome from './welcome.json'
import artifacts from './artifacts.json'
import sync from './sync.json'
import toolCall from './toolCall.json'
import components from './components.json'
import newThread from './newThread.json'
import about from './about.json'
import contextMenu from './contextMenu.json'
import promptSetting from './promptSetting.json'
import plan from './plan.json'
import sidebar from './sidebar.json'

// Individual top-level keys
const others = {
  Silicon: 'SiliconFlow',
  Qiniu: 'Qiniu',
  QwenLM: 'Modelo Qwen',
  Doubao: 'Volcano Engine',
  PPIO: 'PPIO Cloud',
  Moonshot: 'Moonshot AI',
  DashScope: 'Alibaba Bailian',
  Hunyuan: 'Hunyuan',
  searchDisclaimer:
    'O DeepChat é apenas uma ferramenta auxiliar que organiza e resume dados públicos retornados por mecanismos de busca quando os usuários iniciam buscas ativamente, ajudando-os a visualizar e entender os resultados de busca de maneira mais conveniente.\n1. Uso de Dados Públicos\nEste software processa apenas dados que estão publicamente disponíveis em sites ou mecanismos de busca de destino sem necessidade de login. Antes de usar, certifique-se de revisar e cumprir os termos de serviço do site ou mecanismo de busca de destino para garantir que seu uso seja legal e em conformidade.\n2. Precisão e Responsabilidade da Informação\nO conteúdo organizado e gerado por este software é apenas para referência e não constitui qualquer forma de aconselhamento legal, comercial ou outro. Os desenvolvedores não oferecem garantias quanto à precisão, completude, atualidade ou legalidade dos resultados de busca, e quaisquer consequências decorrentes do uso deste software são de responsabilidade exclusiva do usuário.\n3. Cláusula de Isenção de Responsabilidade\nEste software é fornecido "como está", e os desenvolvedores não assumem qualquer garantia ou responsabilidade expressa ou implícita por seu desempenho, estabilidade ou aplicabilidade. No processo de uso deste software, os desenvolvedores não assumem responsabilidade por quaisquer disputas, perdas ou responsabilidades legais decorrentes de violações de leis e regulamentos relevantes ou das regras do site de destino.\n4. Autodisciplina do Usuário\nAntes de usar este software, os usuários devem entender e confirmar plenamente que seu uso não infringirá os direitos de propriedade intelectual, segredos comerciais ou outros direitos legítimos de terceiros. Quaisquer disputas legais e consequências decorrentes do uso inadequado deste software pelos usuários são de responsabilidade exclusiva dos usuários.\nO uso deste software indica que o usuário leu, entendeu e concordou com todos os termos desta isenção de responsabilidade. Se você tiver alguma dúvida, consulte um assessor jurídico profissional.'
}

export default {
  common,
  update,
  routes,
  chat,
  model,
  thread,
  dialog,
  settings,
  mcp,
  welcome,
  artifacts,
  sync,
  toolCall,
  components,
  newThread,
  about,
  contextMenu,
  promptSetting,
  plan,
  sidebar,
  ...others
}
