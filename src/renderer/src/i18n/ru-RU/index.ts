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

// 单独的顶层键
const others = {
  Silicon: 'Силиконовый Поток',
  QwenLM: 'Модель Qwen',
  Doubao: 'Doubao',
  PPIO: 'PPIO Cloud',
  Moonshot: 'Moonshot'
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
  ...others
}
