# core/utils.py
def matcher_to_dict(m):
    data = {
        "category":     m.category,
        "replaceValue": m.replace_value,
    }
    if m.raw:
        data["raw"] = m.raw
    else:
        data["regex"] = (
            {"pattern": m.regexp_source, "flags": m.regexp_flag}
            if m.regexp_flag else m.regexp_source
        )
    if m.groups:
        data["groups"] = m.groups
    return data


def td_to_dict(t):
    return {
        "id":      t.id,
        "source":  t.source,
        "content": t.content,
        "memo":    t.memo,
    }
