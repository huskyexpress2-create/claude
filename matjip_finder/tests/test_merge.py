from matjip.merge import merge_places, name_similarity, norm_name
from matjip.models import Place, PlatformRating


def p(name, lat=None, lng=None, src="x", **kw):
    pl = Place(name=name, lat=lat, lng=lng, **kw)
    pl.sources.add(src)
    return pl


def test_norm_name():
    assert norm_name("카페 어니언 (성수)") == "어니언"
    assert norm_name("Cafe-Onion") == "onion"


def test_branch_suffix_is_similar():
    assert name_similarity("런던베이글뮤지엄", "런던 베이글 뮤지엄 안국점") >= 0.9


def test_same_place_across_sources_merges_and_keeps_best_fields():
    g = p("버터빵집 성수점", 37.5444, 127.0557, src="google")
    g.ratings.append(PlatformRating("google", 4.5, 1000))
    k = p("버터빵집 성수점", 37.5445, 127.0558, src="kakao", address="서울 성동구 1", category="음식점 > 베이커리")
    m = p("버터빵집", src="manual")  # 좌표 없는 수동 입력은 이름 포함 관계로 병합
    m.ratings.append(PlatformRating("kakao", 4.6, 800))
    merged = merge_places([[g], [k], [m]])
    assert len(merged) == 1
    one = merged[0]
    assert one.sources == {"google", "kakao", "manual"}
    assert one.address == "서울 성동구 1"
    assert {r.platform for r in one.ratings} == {"google", "kakao"}


def test_short_name_without_coords_needs_exact_match():
    # 두 글자 이름은 포함 관계만으로 합치지 않는다 ("빵집" ⊂ "빵집 성수점"은 우연일 수 있음).
    assert len(merge_places([[p("빵집 성수점", 37.5, 127.0)], [p("빵집")]])) == 2


def test_far_apart_branches_do_not_merge():
    a = p("런던베이글뮤지엄 안국점", 37.5794, 126.9861)
    b = p("런던베이글뮤지엄 잠실점", 37.5112, 127.0981)
    assert len(merge_places([[a], [b]])) == 2


def test_neighbors_with_different_names_do_not_merge():
    a = p("소금빵집", 37.5444, 127.0557)
    b = p("국수집", 37.5444, 127.0558)
    assert len(merge_places([[a, b]])) == 2
