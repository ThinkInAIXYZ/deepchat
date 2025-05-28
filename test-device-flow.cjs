#!/usr/bin/env node

/**
 * GitHub Copilot Device Flow 测试脚本
 * 
 * 这个脚本用于测试我们的 Device Flow 实现是否正常工作
 */

const https = require('https')
const fs = require('fs')
const path = require('path')

// 尝试读取 .env 文件
try {
  const envPath = path.join(__dirname, '.env')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8')
    envContent.split('\n').forEach(line => {
      const [key, value] = line.split('=')
      if (key && value && !process.env[key]) {
        process.env[key] = value.trim()
      }
    })
  }
} catch (error) {
  console.warn('Warning: Could not read .env file:', error.message)
}

// 从环境变量读取配置
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || process.env.VITE_GITHUB_CLIENT_ID

if (!CLIENT_ID) {
  console.error('❌ 错误: 需要设置 GITHUB_CLIENT_ID 环境变量')
  console.error('请在 .env 文件中设置:')
  console.error('GITHUB_CLIENT_ID=your_client_id_here')
  process.exit(1)
}

console.log('🔐 GitHub Copilot Device Flow 测试')
console.log('=====================================')
console.log(`Client ID: ${CLIENT_ID}`)
console.log('')

/**
 * 发送HTTP请求的辅助函数
 */
function makeRequest(url, options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = ''
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          resolve({ status: res.statusCode, data: parsed })
        } catch (error) {
          resolve({ status: res.statusCode, data: body })
        }
      })
    })

    req.on('error', reject)

    if (data) {
      req.write(JSON.stringify(data))
    }

    req.end()
  })
}

/**
 * Step 1: 请求设备验证码
 */
async function requestDeviceCode() {
  console.log('📱 Step 1: 请求设备验证码...')
  
  const options = {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'DeepChat-Test/1.0.0'
    }
  }

  const data = {
    client_id: CLIENT_ID,
    scope: 'read:user read:org'
  }

  try {
    const response = await makeRequest('https://github.com/login/device/code', options, data)
    
    console.log(`   状态码: ${response.status}`)
    
    if (response.status !== 200) {
      console.error('❌ 请求失败:', response.data)
      return null
    }

    console.log('✅ 设备验证码获取成功:')
    console.log(`   用户验证码: ${response.data.user_code}`)
    console.log(`   验证地址: ${response.data.verification_uri}`)
    console.log(`   过期时间: ${response.data.expires_in} 秒`)
    console.log(`   轮询间隔: ${response.data.interval} 秒`)
    console.log('')

    return response.data
  } catch (error) {
    console.error('❌ 请求设备验证码失败:', error.message)
    return null
  }
}

/**
 * Step 2: 显示用户指令
 */
function showUserInstructions(deviceData) {
  console.log('🌐 Step 2: 用户认证指令')
  console.log('=====================================')
  console.log('请按照以下步骤完成认证:')
  console.log('')
  console.log(`1. 在浏览器中访问: ${deviceData.verification_uri}`)
  console.log(`2. 输入验证码: ${deviceData.user_code}`)
  console.log('3. 完成GitHub登录和授权')
  console.log('')
  console.log('⏰ 注意: 验证码将在 15 分钟后过期')
  console.log('')
  console.log('🔄 等待您完成认证...')
  console.log('')
}

/**
 * Step 3: 轮询访问令牌
 */
async function pollForAccessToken(deviceData) {
  console.log('🔄 Step 3: 轮询访问令牌...')
  
  const startTime = Date.now()
  const expiresAt = startTime + (deviceData.expires_in * 1000)
  let pollCount = 0

  const options = {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'DeepChat-Test/1.0.0'
    }
  }

  const data = {
    client_id: CLIENT_ID,
    device_code: deviceData.device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
  }

  while (Date.now() < expiresAt) {
    pollCount++
    console.log(`   轮询尝试 ${pollCount}...`)

    try {
      const response = await makeRequest('https://github.com/login/oauth/access_token', options, data)
      
      if (response.status !== 200) {
        console.log(`   HTTP错误: ${response.status}`)
        await sleep(deviceData.interval * 1000)
        continue
      }

      if (response.data.error) {
        switch (response.data.error) {
          case 'authorization_pending':
            console.log('   ⏳ 等待用户授权...')
            break
          case 'slow_down':
            console.log('   🐌 请求过于频繁，减慢轮询速度...')
            await sleep(5000) // 额外等待5秒
            break
          case 'expired_token':
            console.log('   ⏰ 设备验证码已过期')
            return null
          case 'access_denied':
            console.log('   🚫 用户拒绝了授权')
            return null
          default:
            console.log(`   ❌ 未知错误: ${response.data.error}`)
            return null
        }
        await sleep(deviceData.interval * 1000)
        continue
      }

      if (response.data.access_token) {
        console.log('✅ 访问令牌获取成功!')
        console.log(`   令牌类型: ${response.data.token_type}`)
        console.log(`   权限范围: ${response.data.scope}`)
        console.log(`   访问令牌: ${response.data.access_token.substring(0, 20)}...`)
        return response.data.access_token
      }

    } catch (error) {
      console.log(`   💥 轮询请求失败: ${error.message}`)
    }

    await sleep(deviceData.interval * 1000)
  }

  console.log('⏰ 设备验证码已过期')
  return null
}

/**
 * Step 4: 验证访问令牌
 */
async function validateAccessToken(token) {
  console.log('')
  console.log('🔍 Step 4: 验证访问令牌...')
  
  const options = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'DeepChat-Test/1.0.0'
    }
  }

  try {
    const response = await makeRequest('https://api.github.com/user', options)
    
    if (response.status === 200) {
      console.log('✅ 令牌验证成功!')
      console.log(`   用户: ${response.data.login}`)
      console.log(`   姓名: ${response.data.name || 'N/A'}`)
      console.log(`   邮箱: ${response.data.email || 'N/A'}`)
      return true
    } else {
      console.log(`❌ 令牌验证失败: ${response.status}`)
      return false
    }
  } catch (error) {
    console.log(`❌ 令牌验证失败: ${error.message}`)
    return false
  }
}

/**
 * Step 5: 测试GitHub Copilot API访问
 */
async function testCopilotAccess(token) {
  console.log('')
  console.log('🤖 Step 5: 测试GitHub Copilot API访问...')
  
  const options = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'DeepChat-Test/1.0.0',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }

  try {
    const response = await makeRequest('https://api.github.com/copilot_internal/v2/token', options)
    
    console.log(`   状态码: ${response.status}`)
    
    if (response.status === 200) {
      console.log('✅ GitHub Copilot API 访问成功!')
      console.log(`   Copilot令牌: ${response.data.token ? response.data.token.substring(0, 20) + '...' : 'N/A'}`)
      console.log(`   过期时间: ${response.data.expires_at ? new Date(response.data.expires_at * 1000).toISOString() : 'N/A'}`)
      return true
    } else {
      console.log('❌ GitHub Copilot API 访问失败')
      console.log('   可能的原因:')
      console.log('   1. 您的GitHub账户没有Copilot订阅')
      console.log('   2. OAuth权限范围不足')
      console.log('   3. 需要组织级别的Copilot访问权限')
      console.log(`   响应: ${JSON.stringify(response.data, null, 2)}`)
      return false
    }
  } catch (error) {
    console.log(`❌ GitHub Copilot API 测试失败: ${error.message}`)
    return false
  }
}

/**
 * 睡眠函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 主函数
 */
async function main() {
  try {
    // Step 1: 请求设备验证码
    const deviceData = await requestDeviceCode()
    if (!deviceData) {
      process.exit(1)
    }

    // Step 2: 显示用户指令
    showUserInstructions(deviceData)

    // Step 3: 轮询访问令牌
    const accessToken = await pollForAccessToken(deviceData)
    if (!accessToken) {
      console.log('❌ 未能获取访问令牌')
      process.exit(1)
    }

    // Step 4: 验证访问令牌
    const isValid = await validateAccessToken(accessToken)
    if (!isValid) {
      console.log('❌ 访问令牌验证失败')
      process.exit(1)
    }

    // Step 5: 测试GitHub Copilot API访问
    const copilotAccess = await testCopilotAccess(accessToken)
    
    console.log('')
    console.log('🎉 测试完成!')
    console.log('=====================================')
    console.log(`✅ Device Flow 认证: 成功`)
    console.log(`✅ 访问令牌验证: 成功`)
    console.log(`${copilotAccess ? '✅' : '❌'} GitHub Copilot API: ${copilotAccess ? '成功' : '失败'}`)
    
    if (copilotAccess) {
      console.log('')
      console.log('🎊 恭喜! 您的GitHub Copilot Device Flow认证设置正确!')
      console.log('现在可以在DeepChat中使用GitHub Copilot了。')
    } else {
      console.log('')
      console.log('⚠️  访问令牌获取成功，但无法访问GitHub Copilot API。')
      console.log('请检查您的GitHub Copilot订阅状态。')
    }

  } catch (error) {
    console.error('💥 测试过程中发生错误:', error.message)
    process.exit(1)
  }
}

// 运行主函数
main() 