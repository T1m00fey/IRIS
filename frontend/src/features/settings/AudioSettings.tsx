import { useEffect, useRef, useState } from 'react'
import { AudioLines, Headphones, Mic, Play, Square, Volume2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { SettingRow, SettingsCard } from './SettingsControls'

const testSeconds = 10
const meterSteps = 12

function audioError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Разрешите доступ к микрофону в настройках браузера.'
    if (error.name === 'NotFoundError') return 'Подключите микрофон и повторите проверку.'
    if (error.name === 'NotReadableError') return 'Микрофон занят или недоступен. Проверьте настройки системы.'
  }
  return 'Проверка не запустилась. Проверьте подключение устройства и повторите.'
}

export function AudioSettings() {
  const media = navigator.mediaDevices
  const canTest = typeof window.AudioContext === 'function'
  const canTestMic = canTest && typeof media?.getUserMedia === 'function'
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [micState, setMicState] = useState<'idle' | 'requesting' | 'listening'>('idle')
  const [level, setLevel] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [micResult, setMicResult] = useState('')
  const [playing, setPlaying] = useState(false)
  const micTest = useRef<AbortController | null>(null)
  const outputTest = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!media?.enumerateDevices) return
    let active = true
    const refresh = () => void media.enumerateDevices().then(items => {
      if (active) setDevices(items)
    }).catch(() => undefined)
    refresh()
    media.addEventListener('devicechange', refresh)
    return () => {
      active = false
      media.removeEventListener('devicechange', refresh)
    }
  }, [media])

  useEffect(() => () => {
    micTest.current?.abort()
    micTest.current = null
    const output = outputTest.current
    outputTest.current = null
    if (output) void output.close().catch(() => undefined)
  }, [])

  async function checkMicrophone() {
    if (!canTestMic || micTest.current) return
    const test = new AbortController()
    micTest.current = test
    setError('')
    setLevel(0)
    setSeconds(0)
    setMicResult('')
    setMicState('requesting')
    let context: AudioContext | undefined
    let stream: MediaStream | undefined
    let frame = 0
    let timeout = 0
    let heard = false
    const release = () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      stream?.getTracks().forEach(track => track.stop())
      if (context && context.state !== 'closed') void context.close().catch(() => undefined)
    }
    test.signal.addEventListener('abort', release, { once: true })

    try {
      context = new AudioContext()
      // Start the context in the click handler, before the browser permission prompt.
      const resumed = context.resume().catch(() => undefined)
      stream = await media.getUserMedia({ audio: true })
      if (test.signal.aborted) {
        release()
        return
      }
      await resumed
      if (test.signal.aborted) return
      if (context.state !== 'running') await context.resume()
      if (test.signal.aborted) return
      const analyser = context.createAnalyser()
      const samples = new Float32Array(analyser.fftSize)
      context.createMediaStreamSource(stream).connect(analyser)
      void media.enumerateDevices().then(items => {
        if (!test.signal.aborted) setDevices(items)
      }).catch(() => undefined)
      setMicState('listening')
      const started = performance.now()

      const measure = (now: number) => {
        analyser.getFloatTimeDomainData(samples)
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
        heard ||= rms >= 0.015
        setLevel(Math.min(meterSteps, Math.round(rms * 120)))
        setSeconds(Math.floor((now - started) / 1000))
        frame = requestAnimationFrame(measure)
      }
      frame = requestAnimationFrame(measure)
      timeout = window.setTimeout(() => {
        setSeconds(testSeconds)
        stopMicrophone(heard ? 'Микрофон улавливает звук.' : 'Сигнал не обнаружен. Проверьте микрофон и повторите проверку.')
      }, testSeconds * 1000)
    } catch (cause) {
      if (!test.signal.aborted) {
        stopMicrophone()
        setError(audioError(cause))
      }
    }
  }

  function stopMicrophone(result = '') {
    micTest.current?.abort()
    micTest.current = null
    setMicState('idle')
    setLevel(0)
    setMicResult(result)
  }

  async function checkOutput() {
    if (!canTest || outputTest.current) return
    setError('')
    setPlaying(true)
    let context: AudioContext | undefined
    try {
      context = new AudioContext()
      outputTest.current = context
      await context.resume()
      if (outputTest.current !== context) return
      const tone = context.createOscillator()
      const gain = context.createGain()
      const now = context.currentTime
      tone.frequency.value = 440
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.12, now + 0.04)
      gain.gain.linearRampToValueAtTime(0, now + 0.55)
      tone.connect(gain).connect(context.destination)
      await new Promise<void>(resolve => {
        tone.onended = () => resolve()
        tone.start(now)
        tone.stop(now + 0.55)
      })
    } catch {
      if (outputTest.current === context || !context) setError('Не удалось воспроизвести сигнал. Проверьте устройство вывода.')
    } finally {
      if (outputTest.current === context || !context) {
        outputTest.current = null
        setPlaying(false)
        if (context) void context.close().catch(() => undefined)
      }
    }
  }

  const input = devices.find(device => device.kind === 'audioinput' && device.deviceId === 'default')
  const output = devices.find(device => device.kind === 'audiooutput' && device.deviceId === 'default')
  const micHint = micState === 'listening'
    ? 'Скажите что-нибудь и проверьте уровень сигнала.'
    : micResult || 'Проверьте уровень сигнала микрофона.'

  return <SettingsCard title="Аудиоустройства" description="Микрофон, гарнитура и звук" icon={Headphones}>
    <SettingRow title="Микрофон" icon={Mic}>
      <span className="iris-settings-value">{input?.label || 'По умолчанию'}</span>
      <span className="iris-settings-meter" aria-hidden="true">
        {Array.from({ length: meterSteps }, (_, index) => <i key={index} data-active={index < level} />)}
      </span>
    </SettingRow>
    <SettingRow title="Гарнитура" icon={Headphones} description="Выбирается в настройках звука системы." />
    <SettingRow title="Динамики" icon={Volume2}>
      <span className="iris-settings-value">{output?.label || 'По умолчанию'}</span>
      <Button className="iris-settings-audio-play" aria-label="Проверить звук динамиков" disabled={!canTest || playing}
        onClick={() => void checkOutput()}><Play size={16} aria-hidden="true" /></Button>
    </SettingRow>
    <div className="iris-settings-sound">
      <AudioLines size={26} aria-hidden="true" />
      <div><strong>Проверка звука</strong><small>{micHint}</small></div>
      <span className="numeric" aria-hidden="true">00:{String(seconds).padStart(2, '0')}</span>
      <Button disabled={!canTestMic} onClick={() => micState === 'idle' ? void checkMicrophone() : stopMicrophone()}>
        {micState === 'idle' ? <Play size={15} aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
        {micState === 'idle' ? 'Проверить микрофон' : 'Остановить'}
      </Button>
    </div>
    {micState === 'requesting' && <p className="iris-settings-note" role="status">Ожидаем разрешения на доступ к микрофону.</p>}
    {micResult && <span className="sr-only" role="status">{micResult}</span>}
    {!canTestMic && <p className="iris-settings-note">Проверка микрофона требует защищённого подключения и поддержки браузера.</p>}
    {!canTest && <p className="iris-settings-note">Браузер не поддерживает проверку динамиков.</p>}
    {error && <p className="alert iris-settings-note" role="alert">{error}</p>}
  </SettingsCard>
}
