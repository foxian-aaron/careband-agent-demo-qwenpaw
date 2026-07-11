import { useState } from "react";
import { useDemo } from "../store/demoStore";
import { MockNoticeBanner } from "./MockNoticeBanner";

interface VoiceInputSimulatorProps {
  elderId: string;
}

const quickTexts = ["我有点头晕", "我胸口闷", "我不舒服", "我找不到路", "我今天吃什么药"];

export const VoiceInputSimulator = ({ elderId }: VoiceInputSimulatorProps) => {
  const { dispatch } = useDemo();
  const [text, setText] = useState("");

  const submit = (value: string) => {
    const finalText = value.trim();
    if (!finalText) return;
    dispatch({ type: "SIMULATE_VOICE_INPUT", elderId, text: finalText });
    setText(finalText);
  };

  return (
    <section className="panel simulator-panel">
      <div className="section-title">
        <span>语音输入模拟</span>
        <h2>文字模拟老人语音进入系统</h2>
      </div>
      <MockNoticeBanner>当前只用文字模拟语音采集，但会按真实 voice 事件契约进入后端；不保存原始录音，也不调用 ASR / TTS。</MockNoticeBanner>
      <textarea
        placeholder="输入老人语音内容，例如：我有点头晕 / 我不舒服 / 我找不到路"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="button-row">
        {quickTexts.map((item) => (
          <button key={item} onClick={() => submit(item)}>
            {item}
          </button>
        ))}
        <button className="primary" onClick={() => submit(text)}>
          提交 voice 事件
        </button>
      </div>
    </section>
  );
};
