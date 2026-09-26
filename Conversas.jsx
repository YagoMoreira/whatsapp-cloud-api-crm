import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ConversasLista from "@/components/whatsapp/ConversasLista";
import WhatsAppLogo from "@/components/whatsapp/WhatsAppLogo";
import Thread from "@/components/whatsapp/Thread";

/**
 * Caixa de entrada do WhatsApp (rota /whatsapp/conversas): lista à esquerda,
 * conversa à direita — mesmo desenho do Chat Global, e de propósito: quem já
 * usa o chat do escritório não precisa aprender outra tela.
 *
 * Aceita ?conversa=<id> para links de outras telas (um ticket, um cliente)
 * abrirem direto no fio certo.
 */
export default function WhatsAppConversas() {
  const [params, setParams] = useSearchParams();
  const [conversaId, setConversaId] = useState(() => params.get("conversa") || null);

  // Mantém a URL espelhando a conversa aberta: F5 e link compartilhado voltam
  // para o mesmo lugar (o servidor ainda confere quem pode abrir).
  useEffect(() => {
    const atual = params.get("conversa") || null;
    if (conversaId !== atual) {
      setParams(conversaId ? { conversa: conversaId } : {}, { replace: true });
    }
  }, [conversaId, params, setParams]);

  // Uma mudança na conversa (lida, vínculo, envio) precisa aparecer na lista
  // sem esperar o próximo tique da consulta.
  const [versaoLista, setVersaoLista] = useState(0);
  const atualizarLista = useCallback(() => setVersaoLista((v) => v + 1), []);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <WhatsAppLogo className="h-9 w-9" />
        <div>
          <h1 className="text-lg font-bold leading-tight text-slate-900 dark:text-white">WhatsApp</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Conversas com clientes pelo número oficial
          </p>
        </div>
      </div>

      <div className="flex h-[calc(100vh-11.5rem)] min-h-[420px] overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[#334155] dark:bg-[#1e293b]">
        <div className={`w-full flex-shrink-0 border-r border-slate-200 dark:border-[#334155] sm:block sm:w-[320px] ${conversaId ? "hidden" : "block"}`}>
          <ConversasLista
            conversaAtivaId={conversaId}
            onSelecionar={setConversaId}
            recarregarEm={versaoLista}
          />
        </div>
        <div className={`min-w-0 flex-1 ${conversaId ? "block" : "hidden sm:block"}`}>
          <Thread
            conversaId={conversaId}
            onVoltar={() => setConversaId(null)}
            onMudouConversa={atualizarLista}
          />
        </div>
      </div>
    </div>
  );
}
