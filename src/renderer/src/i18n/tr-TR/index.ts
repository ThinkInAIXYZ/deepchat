import common from './common.json'
import image from './image.json'
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
import about from './about.json'
import contextMenu from './contextMenu.json'
import promptSetting from './promptSetting.json'
import traceDialog from './traceDialog.json'
import plan from './plan.json'

// Tekil ust duzey anahtarlar
const others = {
  Silicon: 'SiliconFlow',
  Qiniu: 'Qiniu',
  QwenLM: 'Qwen Model',
  Doubao: 'Volcano Engine',
  PPIO: 'PPIO Cloud',
  Moonshot: 'Moonshot AI',
  Hunyuan: 'Hunyuan',
  DashScope: 'Alibaba Bailian',
  Zhipu: 'Zhipu',
  searchDisclaimer:
    'DeepChat yalnızca yardımcı bir araçtır. Kullanıcı aramayı kendisi başlattığında, arama motorlarının döndürdüğü herkese açık verileri düzenler ve özetler; böylece kullanıcıların arama sonuçlarını daha kolay görüntülemesine ve anlamasına yardımcı olur.\n\n1. **Herkese Açık Verilerin Kullanımı**  \nBu yazılım yalnızca hedef web sitelerinde veya arama motorlarında oturum açmadan erişilebilen herkese açık verileri işler. Kullanmadan önce hedef web sitesinin veya arama motorunun hizmet koşullarını mutlaka inceleyin ve bunlara uyun; kullanımınızın yasal ve kurallara uygun olduğundan emin olun.  \n\n2. **Bilgi Doğruluğu ve Sorumluluk**  \nBu yazılım tarafından düzenlenen ve oluşturulan içerik yalnızca referans amaçlıdır; hiçbir şekilde hukuki, ticari veya başka türde bir tavsiye niteliği taşımaz. Geliştiriciler arama sonuçlarının doğruluğu, eksiksizliği, güncelliği veya yasallığı konusunda herhangi bir garanti vermez; yazılımın kullanımından doğan tüm sonuçlardan kullanıcı sorumludur.  \n\n3. **Sorumluluk Reddi**  \nBu yazılım "olduğu gibi" sağlanır. Geliştiriciler performansı, kararlılığı veya belirli bir amaca uygunluğu konusunda açık ya da zımni hiçbir garanti veya sorumluluk üstlenmez. Kullanıcının bu yazılımı kullanırken ilgili yasa ve düzenlemeleri ya da hedef web sitesinin kurallarını ihlal etmesinden doğabilecek herhangi bir uyuşmazlık, kayıp veya hukuki sorumluluktan geliştiriciler sorumlu değildir.  \n\n4. **Kullanıcının Sorumlu Kullanımı**  \nKullanıcılar bu yazılımı kullanmadan önce, kullanım biçimlerinin başkalarının fikri mülkiyet haklarını, ticari sırlarını veya diğer meşru haklarını ihlal etmeyeceğini tam olarak anlamalı ve teyit etmelidir. Kullanıcının uygunsuz kullanımından doğan tüm hukuki uyuşmazlıklar ve sonuçlar kullanıcının kendi sorumluluğundadır.  \n\nBu yazılımı kullanmak, kullanıcının bu sorumluluk reddinin tüm hükümlerini okuduğu, anladığı ve kabul ettiği anlamına gelir. Sorularınız varsa profesyonel bir hukuk danışmanına başvurun.'
}

export default {
  common,
  image,
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
  about,
  contextMenu,
  promptSetting,
  traceDialog,
  plan,
  ...others
}
