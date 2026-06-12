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

// Kekunci peringkat atas yang berasingan
const others = {
  Silicon: 'SiliconFlow',
  Qiniu: 'Qiniu',
  QwenLM: 'Model Qwen',
  Doubao: 'Volcano Engine',
  PPIO: 'PPIO Cloud',
  Moonshot: 'Moonshot AI',
  Hunyuan: 'Hunyuan',
  DashScope: 'Alibaba Bailian',
  Zhipu: 'Zhipu',
  searchDisclaimer:
    'DeepChat hanya alat bantuan. Apabila pengguna memulakan carian secara aktif, DeepChat menyusun dan merumuskan data awam yang dikembalikan oleh enjin carian supaya pengguna dapat melihat dan memahami hasil carian dengan lebih mudah.\n\n1. **Penggunaan Data Awam**  \nPerisian ini hanya memproses data pada laman sasaran atau enjin carian yang tersedia secara awam dan boleh dicapai tanpa log masuk. Sebelum menggunakan perisian ini, sila semak dan patuhi terma perkhidmatan laman sasaran atau enjin carian untuk memastikan penggunaan anda sah dan mematuhi peraturan.  \n\n2. **Ketepatan Maklumat dan Tanggungjawab**  \nKandungan yang disusun dan dijana oleh perisian ini hanya untuk rujukan, dan tidak membentuk nasihat undang-undang, perniagaan, atau nasihat lain dalam apa-apa bentuk. Pembangun tidak memberikan sebarang jaminan terhadap ketepatan, kelengkapan, ketepatan masa, atau kesahan hasil carian. Sebarang akibat daripada penggunaan perisian ini ditanggung sepenuhnya oleh pengguna.  \n\n3. **Penafian**  \nPerisian ini disediakan dalam keadaan "as is". Pembangun tidak menanggung sebarang jaminan atau tanggungjawab, sama ada tersurat atau tersirat, terhadap prestasi, kestabilan, atau kesesuaiannya. Jika penggunaan perisian ini menyebabkan sebarang pertikaian, kerugian, atau liabiliti undang-undang akibat pelanggaran undang-undang, peraturan, atau ketetapan laman sasaran, pembangun tidak menanggung sebarang tanggungjawab.  \n\n4. **Tanggungjawab Pengguna**  \nSebelum menggunakan perisian ini, pengguna hendaklah memahami dan mengesahkan bahawa penggunaan mereka tidak akan melanggar hak harta intelek, rahsia perdagangan, atau hak sah pihak lain. Sebarang pertikaian undang-undang dan akibat yang timbul daripada penggunaan perisian ini secara tidak wajar adalah tanggungjawab pengguna sepenuhnya.  \n\nDengan menggunakan perisian ini, pengguna dianggap telah membaca, memahami, dan bersetuju dengan semua terma dalam penafian ini. Jika ada pertanyaan, sila dapatkan nasihat daripada penasihat undang-undang profesional.'
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
