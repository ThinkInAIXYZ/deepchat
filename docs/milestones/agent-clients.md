- 我们想要的是一个纯agent的客户端，而不是传统的chatbot。
- agent的客户端应该是可以多种agent选择的逻辑，模型是从属于agent的逻辑。
- workspace是agent必须有的操作对象和探索空间，workspace应该从属于session/converstaion，workspace中的workdir定义了工作的路径。workspace还应该链接到browser，bash进程，其他的agent等。
- agent应该可以和其他agent进行协作与通信。
- 不同的agent有自己的commands和sessions。

GUI
- 以workspace和核心，还是以conversation为核心？
  - workspace代表着用户需要先建立文件夹，以及定义项目。
  - conversation代表着用户在临时性的环境中开始使用。
  - conversation又和session有关系，session是属于conversation的子集（在大部分的acp agent上）
- 