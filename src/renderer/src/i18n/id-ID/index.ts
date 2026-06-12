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

// Kunci tingkat atas terpisah
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
    'DeepChat hanya berfungsi sebagai alat bantu. Saat pengguna secara aktif memulai pencarian, DeepChat menyusun dan merangkum data publik yang dikembalikan oleh mesin pencari agar hasil pencarian lebih mudah dilihat dan dipahami.\n\n1. **Penggunaan Data Publik**  \nPerangkat lunak ini hanya memproses data dari situs web target atau mesin pencari yang tersedia untuk publik dan dapat diakses tanpa login. Sebelum menggunakan, pastikan Anda membaca dan mematuhi ketentuan layanan situs web target atau mesin pencari agar penggunaan Anda sah dan sesuai aturan.  \n\n2. **Akurasi Informasi dan Tanggung Jawab**  \nKonten yang disusun dan dihasilkan oleh perangkat lunak ini hanya untuk referensi, dan bukan merupakan nasihat hukum, bisnis, atau bentuk nasihat lainnya. Pengembang tidak memberikan jaminan apa pun atas akurasi, kelengkapan, ketepatan waktu, atau legalitas hasil pencarian. Segala konsekuensi yang timbul dari penggunaan perangkat lunak ini menjadi tanggung jawab pengguna sepenuhnya.  \n\n3. **Klausul Penafian**  \nPerangkat lunak ini disediakan "sebagaimana adanya". Pengembang tidak menanggung jaminan atau tanggung jawab tersurat maupun tersirat atas kinerja, stabilitas, atau kesesuaiannya. Jika selama penggunaan perangkat lunak ini timbul sengketa, kerugian, atau tanggung jawab hukum akibat pelanggaran hukum, peraturan, atau ketentuan situs web target, pengembang tidak bertanggung jawab atas hal tersebut.  \n\n4. **Tanggung Jawab Pengguna**  \nSebelum menggunakan perangkat lunak ini, pengguna harus memahami dan memastikan bahwa penggunaan mereka tidak melanggar hak kekayaan intelektual, rahasia dagang, atau hak sah pihak lain. Setiap sengketa hukum dan konsekuensi akibat penggunaan perangkat lunak ini secara tidak tepat menjadi tanggung jawab pengguna sepenuhnya.  \n\nDengan menggunakan perangkat lunak ini, pengguna dianggap telah membaca, memahami, dan menyetujui semua ketentuan dalam penafian ini. Jika ada pertanyaan, konsultasikan dengan penasihat hukum profesional.'
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
