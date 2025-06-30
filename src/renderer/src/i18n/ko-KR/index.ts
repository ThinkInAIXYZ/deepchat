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

// 单独的顶层键
const others = {
  Silicon: 'SiliconFlow',
  Qiniu: 'Qiniu',
  QwenLM: 'QwenLM',
  Doubao: 'Doubao',
  PPIO: 'PPIO',
  Moonshot: 'Moonshot',
  Hunyuan: 'Hunyuan',
  DashScope: 'Aliyun Bailian',
  searchDisclaimer:
    'DeepChat은 사용자가 적극적으로 검색을 시작할 때 검색 엔진에서 반환한 공개 데이터를 정리하고 요약하여 사용자가 검색 결과를 더 편리하게 볼 수 있도록 도와주는 보조 도구일 뿐입니다.\n1. 공개 데이터 사용\n이 소프트웨어는 로그인 없이 액세스할 수 있는 대상 웹사이트 또는 검색 엔진에서 공개적으로 사용 가능한 데이터만 처리합니다. 사용하기 전에 대상 웹사이트 또는 검색 엔진의 서비스 약관을 검토하고 준수하여 사용이 합법적이고 규정을 준수하는지 확인하십시오.\n2. 정보 정확성 및 책임\n이 소프트웨어에서 구성 및 생성된 콘텐츠는 참조용일 뿐이며 법적, 비즈니스 또는 기타 조언의 어떤 형태도 구성하지 않습니다. 개발자는 검색 결과의 정확성, 완전성, 적시성 또는 합법성에 대해 보증하지 않으며, 이 소프트웨어 사용으로 인해 발생하는 모든 결과는 전적으로 사용자의 책임입니다.\n3. 면책 조항\n이 소프트웨어는 "있는 그대로" 제공되며, 개발자는 성능, 안정성 또는 적용 가능성에 대한 명시적 또는 묵시적 보증이나 책임을 지지 않습니다. 이 소프트웨어를 사용하는 과정에서 관련 법률 및 규정 또는 대상 웹사이트의 규칙 위반으로 인해 발생하는 분쟁, 손실 또는 법적 책임에 대해 개발자는 어떠한 책임도 지지 않습니다.\n4. 사용자 자율 규제\n이 소프트웨어를 사용하기 전에 사용자는 자신의 사용이 타인의 지적 재산권, 영업 비밀 또는 기타 합법적 권리를 침해하지 않는다는 것을 충분히 이해하고 확인해야 합니다. 사용자의 부적절한 소프트웨어 사용으로 인해 발생하는 법적 분쟁 및 결과는 전적으로 사용자의 책임입니다.\n이 소프트웨어를 사용하면 사용자가 이 면책 조항의 모든 조건을 읽고, 이해하고, 동의했음을 나타냅니다. 질문이 있으시면 전문 법률 고문에게 문의하십시오.'
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
  ...others
}
