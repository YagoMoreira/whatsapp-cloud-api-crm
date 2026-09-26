import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Megaphone, Check, X, Send, Eye, Trash2, Loader2, AlertTriangle, ChevronLeft,
} from "lucide-react";
import toast from "react-hot-toast";
import PageHeader from "@/components/shared/PageHeader";
import LoadingState from "@/components/shared/LoadingState";
import {
  listarCampanhas, detalheCampanha, listarTemplatesAprovados, editarCampanha,
  removerDestinatario, previaCampanha, submeterCampanha, decidirCampanha,
  cancelarCampanha, ROTULO_STATUS, COR_STATUS, ROTULO_DESTINO,
} from "@/lib/whatsapp/campanhas";

/**
 * Campanhas de WhatsApp — montar, aprovar, acompanhar.
 *
 * Duas colunas: a lista à esquerda, a campanha aberta à direita. Mesmo desenho
 * da caixa de entrada, e pelo mesmo motivo — a pessoa passa o tempo comparando
 * uma com a outra.
 *
 * O PÚBLICO NÃO É ESCOLHIDO AQUI. Gente entra pelas telas de Clientes e
 * Prospects, com os filtros que já existem lá. Esta tela cuida do conteúdo, da
 * aprovação e do acompanhamento. Duplicar os filtros aqui seria manter dois
 * lugares em pé fazendo a mesma coisa.
 */

const CAMPOS = [
  { valor: "nome", rotulo: "Nome completo" },
  { valor: "primeiroNome", rotulo: "Primeiro nome" },
  { valor: "empresa", rotulo: "Empresa" },
  { valor: "responsavelNome", rotulo: "Quem criou a campanha" },
];

const Etiqueta = ({ status }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${COR_STATUS[status] || COR_STATUS.rascunho}`}>
    {ROTULO_STATUS[status] || status}
  </span>
);

export default function Campanhas() {
  const [params, setParams] = useSearchParams();
  const abertaId = params.get("campanha") || "";

  const [campanhas, setCampanhas] = useState([]);
  const [souAdmin, setSouAdmin] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [detalhe, setDetalhe] = useState(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [previa, setPrevia] = useState(null);
  const [decisao, setDecisao] = useState({ aberta: false, aprovar: true, motivo: "" });
  const [salvando, setSalvando] = useState(false);

  const recarregarLista = useCallback(async () => {
    try {
      const r = await listarCampanhas();
      setCampanhas(r?.campanhas || []);
      setSouAdmin(!!r?.souAdmin);
    } catch (e) {
      toast.error(e?.message || "Não foi possível carregar as campanhas.");
    } finally {
      setCarregando(false);
    }
  }, []);

  const recarregarDetalhe = useCallback(async (id) => {
    if (!id) { setDetalhe(null); return; }
    setCarregandoDetalhe(true);
    try {
      setDetalhe(await detalheCampanha(id));
    } catch (e) {
      toast.error(e?.message || "Não foi possível abrir a campanha.");
      setDetalhe(null);
    } finally {
      setCarregandoDetalhe(false);
    }
  }, []);

  useEffect(() => { recarregarLista(); }, [recarregarLista]);
  useEffect(() => { recarregarDetalhe(abertaId); }, [abertaId, recarregarDetalhe]);
  useEffect(() => { listarTemplatesAprovados().then((r) => setTemplates(r?.templates || [])).catch(() => {}); }, []);

  const campanha = detalhe?.campanha || null;
  const eRascunho = campanha?.status === "rascunho";

  const template = useMemo(
    () => templates.find((t) => String(t.id) === String(campanha?.templateId)) || null,
    [templates, campanha?.templateId],
  );

  async function salvar(patch) {
    if (!campanha) return;
    setSalvando(true);
    try {
      await editarCampanha(campanha.id, patch);
      await recarregarDetalhe(campanha.id);
      await recarregarLista();
    } catch (e) {
      toast.error(e?.message || "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function escolherTemplate(id) {
    const t = templates.find((x) => String(x.id) === String(id));
    // Uma regra por variável do template, na mesma ordem. A ordem é contrato
    // com o servidor: trocá-la não dá erro, só manda a frase errada.
    const variaveis = (t?.metaVariaveis || []).map(() => ({ origem: "fixo", valor: "" }));
    await salvar({ templateId: id, variaveis });
  }

  async function verPrevia() {
    try {
      setPrevia(await previaCampanha(campanha.id));
    } catch (e) {
      toast.error(e?.message || "Não foi possível montar a prévia.");
    }
  }

  async function submeter() {
    setSalvando(true);
    try {
      await submeterCampanha(campanha.id);
      toast.success("Campanha enviada para aprovação.");
      await recarregarDetalhe(campanha.id);
      await recarregarLista();
    } catch (e) {
      toast.error(e?.message || "Não foi possível submeter.");
    } finally {
      setSalvando(false);
    }
  }

  async function decidir() {
    setSalvando(true);
    try {
      await decidirCampanha(campanha.id, decisao.aprovar, decisao.motivo);
      toast.success(decisao.aprovar ? "Campanha aprovada." : "Campanha recusada.");
      setDecisao({ aberta: false, aprovar: true, motivo: "" });
      await recarregarDetalhe(campanha.id);
      await recarregarLista();
    } catch (e) {
      toast.error(e?.message || "Não foi possível registrar a decisão.");
    } finally {
      setSalvando(false);
    }
  }

  async function cancelar() {
    setSalvando(true);
    try {
      await cancelarCampanha(campanha.id);
      await recarregarDetalhe(campanha.id);
      await recarregarLista();
    } catch (e) {
      toast.error(e?.message || "Não foi possível cancelar.");
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <LoadingState />;

  const aguardando = campanhas.filter((c) => c.status === "aguardando_aprovacao").length;

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Campanhas de WhatsApp"
        subtitle="Envio em lote para clientes e prospects, com aprovação e fila"
        icon={Megaphone}
      />

      {souAdmin && aguardando > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="text-amber-900 dark:text-amber-200">
            {aguardando} {aguardando === 1 ? "campanha aguarda" : "campanhas aguardam"} a sua aprovação.
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* ── Lista ─────────────────────────────────────────────────────── */}
        <div className={`space-y-2 ${abertaId ? "hidden lg:block" : ""}`}>
          {campanhas.length === 0 ? (
            <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
              Nenhuma campanha ainda. Elas começam pela seleção nas telas de
              Clientes ou Prospects.
            </div>
          ) : campanhas.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setParams({ campanha: c.id })}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                String(c.id) === abertaId
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{c.nome}</span>
                <Etiqueta status={c.status} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.totalDestinatarios} {c.totalDestinatarios === 1 ? "pessoa" : "pessoas"}
                {c.totalEnviadas > 0 && ` · ${c.totalEnviadas} enviadas`}
              </p>
            </button>
          ))}
        </div>

        {/* ── Campanha aberta ───────────────────────────────────────────── */}
        <div>
          {!abertaId ? (
            <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">
              Escolha uma campanha à esquerda.
            </div>
          ) : carregandoDetalhe ? (
            <LoadingState />
          ) : !campanha ? (
            <div className="rounded-lg border border-border p-10 text-center text-sm text-muted-foreground">
              Campanha não encontrada.
            </div>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setParams({})}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"
              >
                <ChevronLeft className="h-4 w-4" /> Todas as campanhas
              </button>

              {/* Cabeçalho */}
              <div className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{campanha.nome}</h2>
                    <p className="text-sm text-muted-foreground">
                      {campanha.finalidade === "marketing" ? "Marketing" : "Aviso operacional"}
                      {campanha.criadoPorNome && ` · criada por ${campanha.criadoPorNome}`}
                    </p>
                  </div>
                  <Etiqueta status={campanha.status} />
                </div>

                {campanha.descricao && (
                  <p className="mt-3 border-t border-border pt-3 text-sm">{campanha.descricao}</p>
                )}

                {campanha.motivoDecisao && (
                  <p className="mt-3 rounded-md bg-muted/50 p-2 text-sm">
                    <span className="font-medium">
                      {campanha.status === "recusada" ? "Motivo da recusa: " : "Observação: "}
                    </span>
                    {campanha.motivoDecisao}
                  </p>
                )}

                {campanha.aprovadoPorNome && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Aprovada por {campanha.aprovadoPorNome}
                  </p>
                )}
              </div>

              {/* Placar */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { r: "Na fila", v: Math.max(0, campanha.totalDestinatarios - campanha.totalEnviadas - campanha.totalFalhas - campanha.totalPulados) },
                  { r: "Enviadas", v: campanha.totalEnviadas, cor: "text-emerald-600 dark:text-emerald-400" },
                  { r: "Não enviadas", v: campanha.totalPulados, cor: "text-amber-600 dark:text-amber-400" },
                  { r: "Falhas", v: campanha.totalFalhas, cor: "text-red-600 dark:text-red-400" },
                ].map(({ r, v, cor }) => (
                  <div key={r} className="rounded-lg border border-border p-3">
                    <p className={`text-xl font-semibold ${cor || ""}`}>{v}</p>
                    <p className="text-xs text-muted-foreground">{r}</p>
                  </div>
                ))}
              </div>

              {["aprovada", "enviando"].includes(campanha.status) && (
                <p className="text-xs text-muted-foreground">
                  Enviando {campanha.enviadasHoje} de até {campanha.limiteDiario} hoje.
                  O restante segue nas próximas rodadas — a Meta limita destinatários
                  únicos por 24h, e estourar o teto derruba a qualidade do número.
                </p>
              )}

              {/* Conteúdo — só enquanto é rascunho */}
              {eRascunho && (
                <div className="space-y-4 rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold">O que vai ser enviado</h3>

                  <div className="space-y-1.5">
                    <Label>Template aprovado</Label>
                    <Select
                      value={campanha.templateId ? String(campanha.templateId) : ""}
                      onValueChange={escolherTemplate}
                    >
                      <SelectTrigger><SelectValue placeholder="Escolha um template" /></SelectTrigger>
                      <SelectContent>
                        {templates.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>{t.titulo}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {templates.length === 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        Nenhum template aprovado cadastrado. Campanha é sempre fora da
                        janela de 24h, e ali a Meta só aceita template aprovado por ela.
                      </p>
                    )}
                  </div>

                  {template && (
                    <>
                      <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs">
                        {template.conteudo}
                      </pre>

                      {(template.metaVariaveis || []).map((rotulo, i) => {
                        const regra = campanha.variaveis?.[i] || { origem: "fixo", valor: "" };
                        const trocar = (patch) => {
                          const novas = [...(campanha.variaveis || [])];
                          novas[i] = { ...regra, ...patch };
                          salvar({ variaveis: novas });
                        };
                        return (
                          <div key={i} className="space-y-1.5">
                            <Label>{`{{${i + 1}}} — ${rotulo}`}</Label>
                            <div className="flex gap-2">
                              <Select
                                value={regra.origem || "fixo"}
                                onValueChange={(v) => trocar({ origem: v })}
                              >
                                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="fixo">Texto fixo</SelectItem>
                                  <SelectItem value="campo">Do cadastro</SelectItem>
                                </SelectContent>
                              </Select>
                              {regra.origem === "campo" ? (
                                <Select
                                  value={regra.campo || "nome"}
                                  onValueChange={(v) => trocar({ campo: v })}
                                >
                                  <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {CAMPOS.map((c) => (
                                      <SelectItem key={c.valor} value={c.valor}>{c.rotulo}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Input
                                  className="flex-1"
                                  defaultValue={regra.valor || ""}
                                  onBlur={(e) => trocar({ valor: e.target.value })}
                                  placeholder="O mesmo texto para todos"
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="teto">Teto por dia</Label>
                    <Input
                      id="teto"
                      type="number"
                      className="w-32"
                      defaultValue={campanha.limiteDiario}
                      onBlur={(e) => salvar({ limiteDiario: Number(e.target.value) })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Quantas saem por dia. O atendimento humano e as automações dividem
                      o mesmo teto do número, por isso o padrão é conservador.
                    </p>
                  </div>
                </div>
              )}

              {/* Público */}
              <div className="rounded-lg border border-border">
                <div className="flex items-center justify-between border-b border-border p-3">
                  <h3 className="text-sm font-semibold">
                    Público ({detalhe.totalLinhas})
                  </h3>
                  {eRascunho && (
                    <p className="text-xs text-muted-foreground">
                      Acrescente mais gente pelas telas de Clientes e Prospects
                    </p>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {(detalhe.destinatarios || []).map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{d.nome || d.telefone}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.tipo === "prospect" ? "Prospect" : "Cliente"}
                          {d.motivo && ` · ${d.motivo}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`text-xs ${
                          d.status === "pulado" ? "text-amber-600 dark:text-amber-400"
                            : d.status === "falhou" ? "text-red-600 dark:text-red-400"
                              : d.status === "pendente" ? "text-muted-foreground"
                                : "text-emerald-600 dark:text-emerald-400"
                        }`}>
                          {ROTULO_DESTINO[d.status] || d.status}
                        </span>
                        {eRascunho && (
                          <button
                            type="button"
                            aria-label={`Tirar ${d.nome || d.telefone} da campanha`}
                            onClick={async () => {
                              await removerDestinatario(campanha.id, d.id).catch(() => {});
                              await recarregarDetalhe(campanha.id);
                              await recarregarLista();
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Ações */}
              <div className="flex flex-wrap gap-2">
                {eRascunho && (
                  <>
                    <Button variant="outline" onClick={verPrevia} disabled={!campanha.templateId} className="gap-1.5">
                      <Eye className="h-4 w-4" /> Ver prévia
                    </Button>
                    <Button onClick={submeter} disabled={salvando || !campanha.templateId} className="gap-1.5">
                      {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Enviar para aprovação
                    </Button>
                  </>
                )}

                {souAdmin && campanha.status === "aguardando_aprovacao" && (
                  <>
                    <Button
                      onClick={() => setDecisao({ aberta: true, aprovar: true, motivo: "" })}
                      className="gap-1.5"
                    >
                      <Check className="h-4 w-4" /> Aprovar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setDecisao({ aberta: true, aprovar: false, motivo: "" })}
                      className="gap-1.5"
                    >
                      <X className="h-4 w-4" /> Recusar
                    </Button>
                  </>
                )}

                {["aguardando_aprovacao", "aprovada", "enviando"].includes(campanha.status) && (
                  <Button variant="outline" onClick={cancelar} disabled={salvando}>
                    Cancelar campanha
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Prévia */}
      <Dialog open={!!previa} onOpenChange={(v) => !v && setPrevia(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Prévia</DialogTitle>
            <DialogDescription>
              O que os primeiros da fila vão receber, com as variáveis já resolvidas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(previa?.amostras || []).length === 0 && (
              <p className="text-sm text-muted-foreground">Ninguém na fila para mostrar.</p>
            )}
            {(previa?.amostras || []).map((a, i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium">{a.nome || a.telefone}</p>
                <ol className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                  {a.valores.map((v, j) => (
                    <li key={j}>{`{{${j + 1}}} → `}{v || <em className="text-amber-600">vazio</em>}</li>
                  ))}
                </ol>
                {a.incompleta && (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    Variável vazia: a Meta recusa o template inteiro, então esta
                    pessoa vai ser pulada em vez de gerar uma recusa.
                  </p>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Decisão do administrador */}
      <Dialog open={decisao.aberta} onOpenChange={(v) => !v && setDecisao({ ...decisao, aberta: false })}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{decisao.aprovar ? "Aprovar campanha" : "Recusar campanha"}</DialogTitle>
            <DialogDescription>
              {decisao.aprovar
                ? `Liberando ${campanha?.totalDestinatarios || 0} mensagens pelo número da empresa, em rodadas de até ${campanha?.limiteDiario || 200} por dia.`
                : "Quem montou a campanha recebe o motivo pelo sininho."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="motivo">
                {decisao.aprovar ? "Observação (opcional)" : "Motivo"}
              </Label>
              <Textarea
                id="motivo"
                value={decisao.motivo}
                onChange={(e) => setDecisao({ ...decisao, motivo: e.target.value })}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDecisao({ ...decisao, aberta: false })}>
                Voltar
              </Button>
              <Button onClick={decidir} disabled={salvando}>
                {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {decisao.aprovar ? "Aprovar" : "Recusar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
