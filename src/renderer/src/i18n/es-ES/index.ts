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

// Individual top-level keys
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
    'DeepChat actúa únicamente como herramienta auxiliar: cuando el usuario inicia una búsqueda, organiza y resume los datos públicos devueltos por los motores de búsqueda para que los resultados sean más fáciles de consultar y comprender.\n\n1. **Uso de datos públicos**  \nEste software solo procesa datos disponibles públicamente en sitios web de destino o motores de búsqueda, sin requerir inicio de sesión. Antes de usarlo, revisa y cumple las condiciones de servicio del sitio web o motor de búsqueda correspondiente para garantizar un uso legal y conforme.  \n\n2. **Exactitud de la información y responsabilidad**  \nEl contenido organizado y generado por este software es solo de referencia y no constituye asesoramiento legal, comercial ni de ningún otro tipo. Los desarrolladores no garantizan la exactitud, integridad, actualidad ni legalidad de los resultados de búsqueda; cualquier consecuencia derivada del uso de este software será responsabilidad exclusiva del usuario.  \n\n3. **Exención de responsabilidad**  \nEste software se proporciona "tal cual". Los desarrolladores no asumen ninguna garantía ni responsabilidad, expresa o implícita, sobre su rendimiento, estabilidad o idoneidad. Durante el uso de este software, los desarrolladores no asumirán responsabilidad por disputas, pérdidas o responsabilidades legales derivadas del incumplimiento de leyes, normas o reglas del sitio web de destino.  \n\n4. **Responsabilidad del usuario**  \nAntes de usar este software, el usuario debe comprender y confirmar que su uso no infringirá derechos de propiedad intelectual, secretos comerciales ni otros derechos legítimos de terceros. Cualquier disputa legal o consecuencia causada por un uso inadecuado del software será responsabilidad exclusiva del usuario.  \n\nEl uso de este software implica que el usuario ha leído, comprendido y aceptado todos los términos de este aviso legal. Si tienes dudas, consulta con un asesor legal profesional.'
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
