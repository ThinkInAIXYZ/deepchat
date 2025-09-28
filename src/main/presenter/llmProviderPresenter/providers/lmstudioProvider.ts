import { IConfigPresenter, LLM_PROVIDER } from '@shared/presenter'
import { OpenAICompatibleProvider } from './openAICompatibleProvider'
export class LMStudioProvider extends OpenAICompatibleProvider {
  constructor(provider: LLM_PROVIDER, configPresenter: IConfigPresenter) {
    super(provider, configPresenter)
  }
}
