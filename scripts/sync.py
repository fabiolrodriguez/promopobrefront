import httpx
import json
import sys

KEYWORDS = [
    "smartphone",
    "notebook",
    "fone de ouvido",
    "tv",
    "geladeira",
    "monitor",
    "tablet",
]

MAX_POR_KEYWORD = 10


def buscar_ml(query: str, limit: int = 50) -> list[dict]:
    r = httpx.get(
        "https://api.mercadolibre.com/sites/MLB/search",
        params={"q": query, "limit": limit},
        timeout=10,
    )
    r.raise_for_status()

    produtos = []
    for item in r.json().get("results", []):
        preco = item.get("price", 0)
        preco_original = item.get("original_price")

        if not preco_original or preco_original <= preco:
            continue

        desconto = round((1 - preco / preco_original) * 100)

        produtos.append({
            "titulo": item["title"],
            "preco": preco,
            "preco_original": preco_original,
            "desconto_pct": desconto,
            "loja": "Mercado Livre",
            "link": item["permalink"],
            "imagem": item.get("thumbnail", "").replace("-I.jpg", "-O.jpg"),
            "origem": "mercadolivre",
        })

    return produtos


def main():
    todos = []
    vistos = set()

    for kw in KEYWORDS:
        try:
            produtos = buscar_ml(kw)
            adicionados = 0
            for p in produtos:
                if p["link"] not in vistos and adicionados < MAX_POR_KEYWORD:
                    vistos.add(p["link"])
                    todos.append(p)
                    adicionados += 1
            print(f"[ML] '{kw}': {adicionados} produtos com desconto")
        except Exception as e:
            print(f"[ML] Erro em '{kw}': {e}", file=sys.stderr)

    todos.sort(key=lambda x: x["desconto_pct"], reverse=True)

    with open("produtos.json", "w", encoding="utf-8") as f:
        json.dump(todos, f, ensure_ascii=False, indent=2)

    print(f"\nTotal: {len(todos)} produtos salvos em produtos.json")


if __name__ == "__main__":
    main()
