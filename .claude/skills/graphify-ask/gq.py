#!/usr/bin/env python3
"""gq.py - consulta de bajo coste (en tokens) contra un grafo graphify ya construido.

Solo stdlib. NO requiere el paquete `graphify`, networkx ni el CLI. Nunca vuelca el
grafo completo: hace la travesia en memoria y emite un subgrafo compacto acotado por
presupuesto de tokens, para que el agente cargue el minimo de contexto posible.

Uso:
  python gq.py "<pregunta>" [--graph RUTA] [--dfs] [--budget N] [--depth D] [--starts K]
  python gq.py --path "NODO_A" "NODO_B" [--graph RUTA]
  python gq.py --explain "NODO" [--graph RUTA]

Salida: lineas compactas NODE/EDGE con source_location para citar. Nada mas.
"""
import argparse
import json
import re
import sys
from collections import deque
from pathlib import Path

DEFAULT_GRAPH = "graphify-out/graph.json"
TOKEN_RE = re.compile(r"[^\W\d_]+", re.UNICODE)
CAMEL_RE = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+")


def tokenize(text):
    """Divide una etiqueta en tokens normalizados (camelCase/snake -> minusculas)."""
    out = []
    for chunk in TOKEN_RE.findall(text or ""):
        for part in CAMEL_RE.findall(chunk) or [chunk]:
            t = part.lower()
            if 2 <= len(t) <= 30:
                out.append(t)
    return out


def load_graph(path):
    p = Path(path)
    if not p.exists():
        sys.exit(f"ERROR: no existe {path}. Construye el grafo con /graphify <ruta> primero.")
    data = json.loads(p.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in data["nodes"]}
    adj = {nid: [] for nid in nodes}
    ekey = "links" if "links" in data else "edges"
    for e in data[ekey]:
        s, t = e.get("source"), e.get("target")
        if s in adj and t in adj:
            adj[s].append((t, e))
            adj[t].append((s, e))  # grafo no dirigido
    return nodes, adj


def node_terms(nodes):
    """Precomputa el conjunto de tokens de cada nodo para puntuar rapido."""
    return {nid: set(tokenize(n.get("label", ""))) for nid, n in nodes.items()}


def score(nid, terms, nterms):
    return sum(1 for t in terms if t in nterms[nid])


def find_starts(terms, nodes, nterms, k):
    tset = set(terms)
    scored = []
    for nid in nodes:
        s = score(nid, terms, nterms)
        if s == 0:
            continue
        # Bonus por match exacto y penalizacion por ruido: prioriza la etiqueta
        # cuyo conjunto de tokens iguala mejor la consulta (no un spec/test amplio).
        exact = 2 if nterms[nid] == tset else 0
        scored.append((s + exact, -len(nterms[nid] - tset), nid))
    scored.sort(reverse=True)
    return [nid for *_, nid in scored[:k]]


def label(nodes, nid):
    return nodes[nid].get("label", nid)


def emit(lines, budget):
    """Imprime respetando el presupuesto de tokens (~4 chars/token)."""
    out = "\n".join(lines)
    cap = budget * 4
    if len(out) > cap:
        out = out[:cap] + f"\n... (truncado a ~{budget} tokens; usa --budget N para mas)"
    print(out)


def cmd_query(args, nodes, adj):
    nterms = node_terms(nodes)
    terms = tokenize(args.query)
    starts = find_starts(terms, nodes, nterms, args.starts)
    if not starts:
        print(f"Sin nodos que coincidan con: {terms}. El corpus no tiene vocabulario para esta pregunta.")
        return
    sub_nodes, sub_edges = set(starts), []
    if args.dfs:
        visited, stack = set(), [(n, 0) for n in reversed(starts)]
        while stack:
            node, depth = stack.pop()
            if node in visited or depth > args.depth:
                continue
            visited.add(node)
            sub_nodes.add(node)
            for nb, e in adj[node]:
                if nb not in visited:
                    stack.append((nb, depth + 1))
                    sub_edges.append((node, nb, e))
    else:
        frontier = set(starts)
        for _ in range(args.depth):
            nxt = set()
            for n in frontier:
                for nb, e in adj[n]:
                    if nb not in sub_nodes:
                        nxt.add(nb)
                        sub_edges.append((n, nb, e))
            sub_nodes |= nxt
            frontier = nxt
    ranked = sorted(sub_nodes, key=lambda nid: score(nid, terms, nterms), reverse=True)
    mode = "DFS" if args.dfs else "BFS"
    lines = [f"Traversal {mode} | inicio: {[label(nodes, n) for n in starts]} | {len(sub_nodes)} nodos"]
    for nid in ranked:
        d = nodes[nid]
        lines.append(f"  NODE {d.get('label', nid)} [src={d.get('source_file','')} loc={d.get('source_location','')}]")
    for u, v, e in sub_edges:
        if u in sub_nodes and v in sub_nodes:
            lines.append(f"  EDGE {label(nodes,u)} --{e.get('relation','')} [{e.get('confidence','')}]--> {label(nodes,v)}")
    emit(lines, args.budget)


def cmd_path(args, nodes, adj):
    nterms = node_terms(nodes)
    a = find_starts(tokenize(args.path[0]), nodes, nterms, 1)
    b = find_starts(tokenize(args.path[1]), nodes, nterms, 1)
    if not a or not b:
        print(f"No se hallaron nodos para: {args.path}")
        return
    src, tgt = a[0], b[0]
    prev, q = {src: None}, deque([src])
    while q:
        cur = q.popleft()
        if cur == tgt:
            break
        for nb, e in adj[cur]:
            if nb not in prev:
                prev[nb] = (cur, e)
                q.append(nb)
    if tgt not in prev:
        print(f"No hay camino entre {label(nodes,src)!r} y {label(nodes,tgt)!r}")
        return
    chain, cur = [], tgt
    while cur is not None:
        step = prev[cur]
        if step is None:
            chain.append((cur, None))
            cur = None
        else:
            p, e = step
            chain.append((cur, e))
            cur = p
    chain.reverse()
    lines = [f"Camino ({len(chain)-1} saltos):"]
    for i, (nid, e) in enumerate(chain):
        if e is not None:
            lines.append(f"  {label(nodes,nid)} <--{e.get('relation','')} [{e.get('confidence','')}]")
        else:
            lines.append(f"  {label(nodes,nid)}")
    emit(lines, args.budget)


def cmd_explain(args, nodes, adj):
    nterms = node_terms(nodes)
    hit = find_starts(tokenize(args.explain), nodes, nterms, 1)
    if not hit:
        print(f"Sin nodo que coincida con {args.explain!r}")
        return
    nid = hit[0]
    d = nodes[nid]
    lines = [
        f"NODE: {d.get('label', nid)}",
        f"  source: {d.get('source_file','?')}  loc: {d.get('source_location','')}",
        f"  community: {d.get('community_name','')}  grado: {len(adj[nid])}",
        "CONEXIONES:",
    ]
    for nb, e in adj[nid]:
        lines.append(f"  --{e.get('relation','')} [{e.get('confidence','')}]--> {label(nodes,nb)} ({nodes[nb].get('source_file','')})")
    emit(lines, args.budget)


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("query", nargs="?", help="pregunta en lenguaje natural")
    ap.add_argument("--path", nargs=2, metavar=("A", "B"))
    ap.add_argument("--explain", metavar="NODO")
    ap.add_argument("--graph", default=DEFAULT_GRAPH)
    ap.add_argument("--dfs", action="store_true")
    ap.add_argument("--budget", type=int, default=1200)
    ap.add_argument("--depth", type=int, default=3)
    ap.add_argument("--starts", type=int, default=3)
    args = ap.parse_args()

    nodes, adj = load_graph(args.graph)
    if args.path:
        cmd_path(args, nodes, adj)
    elif args.explain:
        cmd_explain(args, nodes, adj)
    elif args.query:
        cmd_query(args, nodes, adj)
    else:
        ap.error("da una pregunta, o usa --path A B / --explain NODO")


if __name__ == "__main__":
    main()
