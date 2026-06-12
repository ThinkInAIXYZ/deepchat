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
    'DeepChat chỉ là công cụ phụ trợ tổ chức và tóm tắt dữ liệu công khai được công cụ tìm kiếm trả về khi người dùng chủ động bắt đầu tìm kiếm, giúp người dùng xem và hiểu kết quả tìm kiếm thuận tiện hơn.\\n1. Sử dụng Dữ liệu Công cộng\\nPhần mềm này chỉ xử lý dữ liệu có sẵn công khai trên các trang web mục tiêu hoặc công cụ tìm kiếm mà không yêu cầu đăng nhập. Trước khi sử dụng, hãy nhớ xem xét và tuân thủ các điều khoản dịch vụ của trang web hoặc công cụ tìm kiếm mục tiêu để đảm bảo việc sử dụng của bạn là hợp pháp và tuân thủ.\\n2. Độ chính xác và trách nhiệm của thông tin\\nNội dung do phần mềm này sắp xếp và tạo ra chỉ mang tính chất tham khảo và không cấu thành bất kỳ hình thức tư vấn pháp lý, kinh doanh hoặc tư vấn nào khác. Nhà phát triển không đảm bảo về tính chính xác, đầy đủ, kịp thời hoặc hợp pháp của kết quả tìm kiếm và mọi hậu quả phát sinh từ việc sử dụng phần mềm này hoàn toàn là trách nhiệm của người dùng.\\n3. Điều khoản từ chối trách nhiệm\\nPhần mềm này được cung cấp "nguyên trạng" và các nhà phát triển không chịu bất kỳ bảo đảm hay trách nhiệm rõ ràng hay ngụ ý nào về hiệu suất, tính ổn định hoặc khả năng ứng dụng của phần mềm. Trong quá trình sử dụng phần mềm này, nhà phát triển không chịu trách nhiệm về mọi tranh chấp, tổn thất hoặc trách nhiệm pháp lý phát sinh do vi phạm luật pháp và quy định có liên quan hoặc các quy tắc của trang web mục tiêu.\\n4. Tự kỷ luật của người dùng\\nTrước khi sử dụng phần mềm này, người dùng phải hiểu đầy đủ và xác nhận rằng việc sử dụng của họ sẽ không vi phạm quyền sở hữu trí tuệ, bí mật thương mại hoặc các quyền hợp pháp khác của người khác. Mọi tranh chấp pháp lý và hậu quả phát sinh từ việc người dùng sử dụng phần mềm này không đúng cách đều là trách nhiệm của người dùng.\\nViệc sử dụng phần mềm này cho thấy rằng người dùng đã đọc, hiểu và đồng ý với tất cả các điều khoản của tuyên bố từ chối trách nhiệm này. Nếu bạn có bất kỳ thắc mắc nào, vui lòng tham khảo ý kiến ​​của cố vấn pháp lý chuyên nghiệp.'
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
