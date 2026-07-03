import { useEffect, useRef, useState } from "react";
import Janus from "janus-gateway";
import * as webrtcAdapter from "webrtc-adapter";

type CallState =
  | "idle"
  | "connecting"
  | "registering"
  | "registered"
  | "incoming"
  | "calling"
  | "in_call"
  | "ended"
  | "error";

type IncomingCall = {
  from?: string;
  displayName?: string;
};

// O adapter normaliza a API WebRTC entre os diferentes navegadores
const adapter = (webrtcAdapter as any).default ?? webrtcAdapter;

const JANUS_SERVER = import.meta.env.VITE_JANUS_SERVER || "ws://localhost:8188";

const SIP_EXTENSION = import.meta.env.VITE_SIP_EXTENSION || "7003";
const SIP_DOMAIN = import.meta.env.VITE_SIP_DOMAIN || "vertticegr01.my3cx.com.br";
const SIP_PROXY = import.meta.env.VITE_SIP_PROXY || `sip:${SIP_DOMAIN}:5060`;

const SIP_AUTH_USER = import.meta.env.VITE_SIP_AUTH_USER || "";
const SIP_PASSWORD = import.meta.env.VITE_SIP_PASSWORD || "";

const AUTO_ANSWER_DELAY_MS = 5000;

export default function App() {
  const [status, setStatus] = useState<CallState>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [registered, setRegistered] = useState(false);
  const [autoAnswerCountdown, setAutoAnswerCountdown] = useState(0);

  const janusRef = useRef<any>(null);
  const sipHandleRef = useRef<any>(null);
  const incomingJsepRef = useRef<any>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const janusInitializedRef = useRef(false);

  function addLog(message: string, data?: unknown) {
    let line = message;

    if (data !== undefined) {
      try {
        line = `${message} ${JSON.stringify(data)}`;
      } catch {
        line = `${message} ${String(data)}`;
      }
    }

    console.log(message, data ?? "");
    setLogs((old) =>
      [`${new Date().toLocaleTimeString()} - ${line}`, ...old].slice(0, 100)
    );
  }

  function validateConfig() {
    if (!SIP_AUTH_USER || !SIP_PASSWORD) {
      addLog("Configuração SIP incompleta. Verifique o .env.local");
      setStatus("error");
      return false;
    }
    return true;
  }

  async function initJanus() {
    if (!validateConfig()) return;

    if (sipHandleRef.current) {
      addLog("Janus/SIP plugin já está conectado");
      return;
    }

    setStatus("connecting");
    addLog("Inicializando Janus...");

    Janus.init({
      debug: "all",
      dependencies: Janus.useDefaultDependencies({ adapter }),

      callback: () => {
        janusInitializedRef.current = true;

        const janus = new Janus({
          server: JANUS_SERVER,
          success: () => {
            addLog("Conectado no Janus");
            janusRef.current = janus;
            attachSipPlugin(janus);
          },
          error: (error: any) => {
            addLog("Erro ao conectar no Janus", error);
            setStatus("error");
          },
          destroyed: () => {
            addLog("Sessão Janus destruída");
            janusRef.current = null;
            sipHandleRef.current = null;
            setRegistered(false);
            setStatus("idle");
          },
        });
      },
    });
  }

  function attachSipPlugin(janus: any) {
    janus.attach({
      plugin: "janus.plugin.sip",

      success: (pluginHandle: any) => {
        addLog("Plugin SIP anexado", { id: pluginHandle.getId() });
        sipHandleRef.current = pluginHandle;
        registerSip();
      },

      error: (error: any) => {
        addLog("Erro ao anexar plugin SIP", error);
        setStatus("error");
      },

      consentDialog: (on: boolean) => {
        addLog(on ? "Solicitando permissão de microfone..." : "Permissão de microfone resolvida");
      },

      mediaState: (medium: string, on: boolean) => {
        addLog(`Media state: ${medium} ${on ? "on" : "off"}`);
      },

      webrtcState: (on: boolean) => {
        addLog(`WebRTC ${on ? "conectado" : "desconectado"}`);
      },

      onmessage: (msg: any, jsep: any) => {
        addLog("Mensagem do Janus SIP", msg);

        const result = msg?.result;
        const event = result?.event;

        if (!event) return;

        switch (event) {
          case "registered": {
            setRegistered(true);
            setStatus("registered");
            addLog("Ramal registrado com sucesso no 3CX");
            break;
          }

          case "registration_failed": {
            setRegistered(false);
            setStatus("error");
            addLog("Falha ao registrar ramal", result);
            break;
          }

          // === RECEBIMENTO DE CHAMADAS LIMPO (Apenas UI, aguarda interação) ===
          case "incomingcall": {
            incomingJsepRef.current = jsep; // Pode vir nulo em casos de Fila (Late Negotiation)

            setIncomingCall({
              from: result?.username,
              displayName: result?.displayname,
            });

            setStatus("incoming");
            addLog(`Chamada recebida! Atendimento automático em ${AUTO_ANSWER_DELAY_MS / 1000}s...`);
            break;
          }

          case "calling": {
            setStatus("calling");
            addLog("Chamando...");
            break;
          }

          case "accepted": {
            setStatus("in_call");
            addLog("Chamada aceita", result);

            // Se o 3CX mandou o SDP final agora, processa
            if (jsep && sipHandleRef.current) {
              sipHandleRef.current.handleRemoteJsep({ jsep });
            }
            break;
          }

          case "hangup": {
            setStatus(registered ? "registered" : "ended");
            setIncomingCall(null);
            incomingJsepRef.current = null;

            addLog("Chamada encerrada", result);

            try {
              sipHandleRef.current?.hangup();
            } catch {
              // ignore
            }
            break;
          }

          default: {
            addLog(`Evento SIP recebido: ${event}`, result);
          }
        }
      },

      onlocaltrack: (track: MediaStreamTrack, on: boolean) => {
        addLog(`Local track ${track.kind}: ${on ? "on" : "off"}`);
      },

      onremotetrack: (track: MediaStreamTrack, mid: string, on: boolean) => {
        addLog(`Remote track ${track.kind} mid=${mid}: ${on ? "on" : "off"}`);

        if (!on) return;
        if (track.kind !== "audio") return;

        const stream = new MediaStream([track]);

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          remoteAudioRef.current.play().catch((error) => {
            addLog("Erro ao tocar áudio remoto (Políticas do Navegador)", error);
          });
        }
      },

      oncleanup: () => {
        addLog("Cleanup WebRTC - Liberando recursos de mídia");
      },

      detached: () => {
        addLog("Plugin SIP detached");
        sipHandleRef.current = null;
      },
    });
  }

  function registerSip() {
    const sipHandle = sipHandleRef.current;
    if (!sipHandle) return;

    setStatus("registering");

    const extension = SIP_EXTENSION.trim();
    const domain = SIP_DOMAIN.trim();

    const registerMessage = {
      request: "register",
      username: `sip:${extension}@${domain}`,
      id: extension,
      authuser: SIP_AUTH_USER.trim(),
      auth_user: SIP_AUTH_USER.trim(),
      secret: SIP_PASSWORD.trim(),
      proxy: SIP_PROXY.trim(),
      send_register: true
    };

    sipHandle.send({ message: registerMessage });
  }

  // === ATENDIMENTO MANUAL BLINDADO (Aceita JSEP ou forja Offer se a fila esconder) ===
  function answerCall() {
    const sipHandle = sipHandleRef.current;
    const incomingJsep = incomingJsepRef.current;

    if (!sipHandle) return;

    addLog("Atendendo chamada. Solicitando microfone...", { possuiJsep: !!incomingJsep });

    const webrtcConfig = {
      tracks: [
        { type: 'audio', capture: true, recv: true }
      ],
      success: (jsep: any) => {
        addLog("Mídia WebRTC liberada, enviando Accept para o 3CX");
        
        sipHandle.send({ 
          message: { request: "accept" }, 
          jsep: jsep 
        });
        
        setStatus("in_call");
      },
      error: (error: any) => {
        addLog("Erro ao acessar microfone", error);
        sipHandle.send({ message: { request: "decline", code: 480 } });
        setIncomingCall(null);
        incomingJsepRef.current = null;
        setStatus(registered ? "registered" : "error");
      }
    };

    if (incomingJsep) {
      // Ligações diretas ramal-para-ramal costumam enviar o JSEP
      sipHandle.createAnswer({
        ...webrtcConfig,
        jsep: incomingJsep
      });
    } else {
      // Filas (Late Negotiation) NÃO enviam JSEP. Nós enviamos a Oferta de mídia!
      sipHandle.createOffer(webrtcConfig);
    }
  }

  function hangupCall() {
    if (!sipHandleRef.current) return;
    addLog("Desligando chamada...");
    sipHandleRef.current.send({ message: { request: "hangup" } });
    try { sipHandleRef.current.hangup(); } catch {}
    setIncomingCall(null);
    incomingJsepRef.current = null;
    setStatus(registered ? "registered" : "idle");
  }

  function unregisterSip() {
    if (!sipHandleRef.current) return;
    addLog("Desregistrando ramal...");
    sipHandleRef.current.send({ message: { request: "unregister" } });
    setRegistered(false);
    setIncomingCall(null);
    incomingJsepRef.current = null;
    setStatus("idle");
  }

  function destroyJanus() {
    addLog("Destruindo sessão Janus");
    try { sipHandleRef.current?.hangup(); } catch {}
    try { janusRef.current?.destroy(); } catch {}
    janusRef.current = null;
    sipHandleRef.current = null;
    incomingJsepRef.current = null;
    setIncomingCall(null);
    setRegistered(false);
    setStatus("idle");
  }

  useEffect(() => {
    if (status !== "incoming") {
      setAutoAnswerCountdown(0);
      return;
    }

    setAutoAnswerCountdown(Math.ceil(AUTO_ANSWER_DELAY_MS / 1000));

    const answerTimer = setTimeout(() => {
      answerCall();
    }, AUTO_ANSWER_DELAY_MS);

    const countdownInterval = setInterval(() => {
      setAutoAnswerCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      clearTimeout(answerTimer);
      clearInterval(countdownInterval);
    };
  }, [status]);

  useEffect(() => {
    return () => {
      try {
        sipHandleRef.current?.hangup();
        janusRef.current?.destroy();
      } catch {}
    };
  }, []);

  const isRinging = status === "incoming";
  const isInCall = status === "in_call" || status === "calling";
  const callerLabel =
    incomingCall?.displayName || incomingCall?.from || "Desconhecido";

  return (
    <main style={styles.page}>
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <section style={styles.card}>
        <h1>Janus + 3CX WebRTC Client</h1>

        <p>Status: <strong>{status}</strong></p>
        <p>Janus: <code>{JANUS_SERVER}</code></p>
        <p>Ramal: <strong>{SIP_EXTENSION}</strong></p>

        <div style={styles.row}>
          <button
            onClick={initJanus}
            disabled={
              status === "connecting" ||
              status === "registering" ||
              status === "registered" ||
              isRinging ||
              isInCall
            }
          >
            Conectar e registrar
          </button>

          <button onClick={registerSip} disabled={!sipHandleRef.current || registered}>
            Registrar novamente
          </button>

          <button onClick={unregisterSip} disabled={!registered || isRinging || isInCall}>
            Desregistrar
          </button>
        </div>
      </section>

      <section style={styles.card}>
        <h2>Logs</h2>
        <pre style={styles.logs}>{logs.join("\n")}</pre>
      </section>

      {(isRinging || isInCall) && (
        <div style={styles.popupOverlay}>
          <div style={styles.popup}>
            <p style={styles.popupStatus}>
              {isRinging
                ? "Chamada recebida"
                : status === "calling"
                  ? "Chamando..."
                  : "Em ligação"}
            </p>
            <h2 style={styles.popupTitle}>{callerLabel}</h2>
            {isRinging ? (
              <p style={styles.popupHint}>
                Atendendo automaticamente em {autoAnswerCountdown}s...
              </p>
            ) : (
              <button onClick={hangupCall} style={styles.hangupButton}>
                Desligar
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: 24,
    fontFamily: "system-ui, sans-serif",
    background: "#f4f4f5",
  },
  popupOverlay: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    padding: 24,
    pointerEvents: "none",
    zIndex: 1000,
  },
  popup: {
    pointerEvents: "auto",
    width: 320,
    background: "#111827",
    color: "white",
    borderRadius: 16,
    padding: "20px 24px",
    boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  popupStatus: {
    margin: 0,
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#9ca3af",
  },
  popupTitle: {
    margin: 0,
    fontSize: 22,
    fontWeight: 600,
    wordBreak: "break-word",
  },
  popupHint: {
    margin: 0,
    fontSize: 14,
    color: "#9ca3af",
  },
  hangupButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    background: "#dc2626",
    color: "white",
    border: 0,
    padding: "10px 20px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  card: {
    background: "white",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  },
  row: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
  },
  logs: {
    background: "#111827",
    color: "#d1d5db",
    padding: 16,
    borderRadius: 8,
    overflow: "auto",
    maxHeight: 400,
    fontSize: 12,
    whiteSpace: "pre-wrap",
  },
};