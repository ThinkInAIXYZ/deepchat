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
  Silicon: '硅基流动',
  QwenLM: '千问模型',
  Doubao: '豆包',
  PPIO: '派欧云',
  Moonshot: '月之暗面',
  searchDisclaimer:
    'DeepChat 仅作为辅助工具，用户在主动发起搜索时，对搜索引擎返回的公开数据进行整理和总结，帮助用户更方便地查看和理解搜索结果。\n\n1. **公开数据使用**  \n本软件仅处理目标网站或搜索引擎公开、无需登录即可访问的数据。用户在使用前，请务必查阅并遵守目标网站或搜索引擎的服务条款，确保其使用行为合法合规。  \n\n2. **信息准确性与责任**  \n本软件所整理和生成的内容仅供参考，并不构成任何形式的法律、商业或其他建议。开发者对搜索结果的准确性、完整性、及时性或合法性不作任何保证，因使用本软件所产生的任何后果均由用户自行承担。  \n\n3. **免责条款**  \n本软件以"现状"提供，开发者不对其性能、稳定性及适用性承担任何明示或暗示的保证或责任。用户使用本软件的过程中，如因违反相关法律法规或目标网站规定而引发的任何争议、损失或法律责任，开发者均不承担任何责任。  \n\n4. **用户自律**  \n用户在使用本软件前，应充分了解并确认自己的使用行为不会侵犯他人的知识产权、商业秘密或其他合法权益。对于因用户不当使用本软件而产生的任何法律纠纷和后果，均由用户自行负责。  \n\n用本软件即表示用户已阅读、理解并同意本免责声明的所有条款。如有疑问，请咨询专业法律顾问。'
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
