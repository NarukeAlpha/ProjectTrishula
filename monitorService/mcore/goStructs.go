package mcore

import "log"

var IphoneUserAgentList = []string{
	"iPhone 6", "iPhone 6 plus",
	"iPhone 7", "iPhone 7 plus",
	"iPhone 8", "iPhone 8 plus",
	"iPhone X", "iPhone XR",
	"iPhone XS", "iPhone XS Max",
	"iPhone 11", "iPhone 11 Pro", "iPhone 11 Pro Max",
	"iPhone SE (2nd generation)",
	"iPhone 12 mini", "iPhone 12", "iPhone 12 Pro", "iPhone 12 Pro Max",
	"iPhone 13 mini", "iPhone 13", "iPhone 13 Pro", "iPhone 13 Pro Max",
	"iPhone 14 mini", "iPhone 14", "iPhone 14 Pro", "iPhone 14 Pro Max",
}

type DbMangaEntry struct {
	Did          int    `json:"did"`
	Dmanga       string `json:"dmanga"`
	DlastChapter int    `json:"dlastChapter"`
	Dmonitoring  bool   `json:"dmonitoring"`
	DchapterLink string `json:"dchapterLink"`
	Didentifier  string `json:"didentifier"`
}

type DbChapterEntry struct {
	Did          int    `json:"did"`
	Dchapter     int    `json:"dchapter"`
	DChapterLink string `json:"dChapterlink"`
	Dreleased    bool   `json:"dreleased"`
}
type ProxyStruct struct {
	ip  string
	usr string
	pw  string
}

func AssertErrorToNil(message string, err error) {
	if err != nil {
		log.Panicf(message, err)
	}
}
