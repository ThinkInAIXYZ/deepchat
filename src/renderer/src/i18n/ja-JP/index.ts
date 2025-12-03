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

// 单独的顶层键
const others = {
  Silicon: 'シリコン流動体',
  Qiniu: 'Qiniu',
  QwenLM: 'QwenLM',
  Doubao: '豆包',
  PPIO: 'PPIOクラウド',
  Moonshot: '月の暗面',
  DashScope: '阿里雲百煉',
  searchDisclaimer:
    'DeepChatは補助ツールとして機能し、ユーザーが検索を開始する際に、検索エンジンから返された公開データを整理し要約することで、ユーザーが検索結果をより便利に確認し理解できるようにします。\n\n1. **公開データの使用**  \n本ソフトウェアは、対象のウェブサイトまたは検索エンジンから公開され、ログインなしでアクセスできるデータのみを処理します。使用前に、必ず対象のウェブサイトまたは検索エンジンのサービス規約を確認し、遵守して、使用行為が合法であることを確認してください。\n\n2. **情報の正確性と責任**  \n本ソフトウェアが整理し生成した内容は参考用であり、法律、ビジネス、またはその他のアドバイスのいかなる形式も構成しません。開発者は検索結果の正確性、完全性、適時性、または合法性について保証せず、本ソフトウェアの使用に起因するいかなる結果もユーザーの責任となります。\n\n3. **免責条項**  \n本ソフトウェアは「現状のまま」提供され、開発者はその性能、安定性、または適用性について明示的または暗示的な保証や責任を負いません。ユーザーが本ソフトウェアを使用する過程で、関連する法律や規制、または対象のウェブサイトの規定に違反した場合に生じるいかなる争い、損失、または法的責任についても、開発者は一切責任を負いません。\n\n4. **ユーザーの自律**  \nユーザーは本ソフトウェアを使用する前に、自身の使用行為が他者の知的財産権、営業秘密、またはその他の合法的権利を侵害しないことを十分に理解し確認する必要があります。ユーザーの不適切な使用に起因するいかなる法的紛争や結果についても、ユーザーが全責任を負います。\n\n本ソフトウェアを使用することにより、ユーザーはこの免責条項のすべての条件を読み、理解し、同意したことを示します。質問がある場合は、専門の法律顧問に相談してください。'
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
  ...others
}
