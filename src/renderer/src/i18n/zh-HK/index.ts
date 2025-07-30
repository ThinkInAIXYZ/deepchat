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
import promptSetting from './promptSetting.json'
import agent from './agent.json'

// 单独的顶层键
const others = {
  Silicon: '矽基流動',
  Qiniu: '七牛雲',
  QwenLM: '千問模型',
  Doubao: '豆包',
  PPIO: '派歐雲',
  Moonshot: '月之暗面',
  Hunyuan: '混元',
  DashScope: '阿里雲百煉',
  Zhipu: '智譜',
  searchDisclaimer:
    'DeepChat 僅作為輔助工具，使用者在主動發起搜索時，對搜索引擎返回的公開數據進行整理和總結，幫助使用者更方便地查看和理解搜索結果。\n\n1. **公開數據使用**  \n本軟件僅處理目標網站或搜索引擎公開、無需登錄即可訪問的數據。使用者在使用前，請務必查閱並遵守目標網站或搜索引擎的服務條款，確保其使用行為合法合規。  \n\n2. **信息準確性與責任**  \n本軟件所整理和生成的內容僅供參考，並不構成任何形式的法律、商業或其他建議。開發者對搜索結果的準確性、完整性、及時性或合法性不作任何保證，因使用本軟件所產生的任何後果均由使用者自行承擔。  \n\n3. **免責條款**  \n本軟件以"現狀"提供，開發者不對其性能、穩定性及適用性承擔任何明示或暗示的保證或責任。使用者使用本軟件的過程中，如因違反相關法律法規或目標網站規定而引發的任何爭議、損失或法律責任，開發者均不承擔任何責任。  \n\n4. **使用者自律**  \n使用者在使用本軟件前，應充分了解並確認自己的使用行為不會侵犯他人的知識產權、商業秘密或其他合法權益。對於因使用者不當使用本軟件而產生的任何法律糾紛和後果，均由使用者自行負責。  \n\n使用本軟件即表示使用者已閱讀、理解並同意本免責聲明的所有條款。如有疑問，請諮詢專業法律顧問。'
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
  promptSetting,
  agent,
  ...others
}
