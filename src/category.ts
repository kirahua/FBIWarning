/**
 * @overview
 * @author Steve Xu <stevexugc@gmail.com>
 * @copyright Copyright (c) 2018, Steve Xu
 * @license MIT
 * @preserve
 */
import path from "path";
import readline from "readline";
import COMMON_CONFIG from "./config";
import {log, BaseSpider, CategoryItem} from "./base";
import ParseTableList from "./list";
import PromiseTool from 'bluebird';

/**
 * 解析分类
 */
export default class ParseCategory extends BaseSpider {
    constructor() {
        super();
        this.recursionExecutive();
    }

    /**
     * 入口
     */
    async recursionExecutive() {
        let temp = await this.requestPage(COMMON_CONFIG.baseUrl);
        if (temp) {
            this.parseHtml(temp);
        } else {
            this.requestFailure();
        }
    }

    /**
     * 请求测试失败！
     */
    requestFailure() {
        if (!this.proxyUrl) {
            console.log('当前网络不能访问种子网站，请配置代理！' + COMMON_CONFIG.errorText);
        } else {
            console.log(`代理${this.proxyUrl}不可用!!!`);
        }
        process.exit();
    }

    /**
     * 代理测试成功
     */
    requestSuccess() {
        console.log("代理测试通过!!!");
    }

    /**
     * 解析分类页面
     * @param {Object} $ cheerio 对象
     */
    async parseHtml($: any) {
        let categoryDom = $("#content tr");
        let categoryList: any = this.categoryList;
        categoryDom.each(function () {
            let titleDom = $(this).find("h3>a").eq(0)
            // path.basename 去掉链接中无用的字符
            let link = path.basename(titleDom.attr("href") || "");
            let title = titleDom.text() || "分类名为空";
            let theme = ~~$(this)
                .find("td")
                .eq(1)
                .find("span")
                .text();
            let endPage = ~~(theme / COMMON_CONFIG.pageSize);
            // 每次启动都刷新列表，与网站保持同步
            if (link && title) {
                categoryList[link] = {
                    link, // 链接
                    title, // 标题
                    theme, // 主题 ,即总的列表数量 判断网站更新数据了的重要依据
                    endPage,
                    childCategory: [] // 子类型
                };
            }
        });

        this.requestSuccess();
        let links: string[] = Object.keys(categoryList);
        if (this.isEmpty(links)) {
            this.requestFailure();
            return;
        }
        PromiseTool.map(links, async (url) => {
            return await this.requestPage(COMMON_CONFIG.baseUrl + url);
        }, {
            concurrency: COMMON_CONFIG.connectTasks
        }).then((results: any) => {
                for (let i: number = 0; i < links.length; i++) {
                    this.parseChildCategory(results[i], links[i]);
                }
                this.updateCategoryList();
                this.selectCategory();
            }
        );

    }

    /**
     * 更新分类数据
     */
    updateCategoryList() {
        this.updateJsonFile(this.categoryList, COMMON_CONFIG.categoryConfig, true);
    }

    /**
     * 获取总页数
     */
    getEndPage($: any) {
        let trsLen: number = 0;
        try {
            let trs = $("#ajaxtable tr");
            trsLen = trs.length;
            let number = $("#main .pages")
                .eq(0)
                .text()
                .match(/[0-9/]/gi);
            let endPage: string[] = [];
            let index = number.findIndex((v: string): boolean => v === "/");
            for (++index; index < number.length; index++) {
                endPage.push(number[index]);
            }
            let realPage: string = endPage.join("");
            // log(trsLen)
            if (trsLen > 5) {
                return ~~realPage;
            } else {
                return 0;
            }
        } catch (error) {
            return trsLen > 5;
        }
    }

    /**
     * 解析子分类
     * @param {Object} $ cheerio
     * @param {String} category  所属分类
     */
    parseChildCategory($: any, category: string) {
        if (!$) {
            return false;
        }
        let childDom = $("#ajaxtable th").find("a");
        let childCategory: Array<CategoryItem> = [];
        let categoryList: any = this.categoryList || {};
        childDom.each(function () {
            let link = $(this).attr("href");
            let text = $(this).text();
            let checkLink = link && !categoryList[link] && !link.includes("notice");
            if (checkLink) {
                childCategory.push({
                    link,
                    title: text,
                    endPage: 0
                });
            }
        });
        let endPage = Math.max(COMMON_CONFIG.connectTasks, ~~this.getEndPage($));
        categoryList[category] = Object.assign({}, categoryList[category], {
            endPage,
            childCategory
        });
    }

    /**
     * 选择爬取的大分类
     */
    selectCategory() {
        const instance = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        let categoryList = this.categoryList;
        let links = Object.values(categoryList);
        let text: string[] = [];
        links.forEach((item, index) => {
            if (item.title) {
                text.push(index + 1 + ". >>> " + item.title);
            }
        });

        text.push(`请输入 1~${text.length},回车或者输入非法值解析所有分类?: `);
        let realText: string = text.join("\n");
        instance.question(realText, answer => {
            let value = parseInt(answer);
            let index = value - 1;
            instance.close();
            if (value > links.length || value < 1) {
                // log("解析所有分类")
                index = 0;
                new ParseTableList(index, true, links[index].link, categoryList);
                return false;
            }
            // 页数太少，直接解析整个分类
            if (links[index].endPage <= COMMON_CONFIG.connectTasks) {
                new ParseTableList(index, false, links[index].link, categoryList);
            } else {
                this.selectChildCategory(index, links[index]);
            }
        });
    }

    /**
     * 选择子分类
     * @param {Number} parentIndex 父分类的索引
     * @param {Object} parentCategory 父分类
     */
    selectChildCategory(parentIndex: number, parentCategory: any) {
        const instance = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        let categoryList = this.categoryList;
        let childCategory = parentCategory.childCategory;
        let text = childCategory.map((item: CategoryItem, index: number): string => {
            return index + 1 + ". >>> " + item.title;
        });
        text.push(
            `请输入 1~${childCategory.length},回车或者输入非法值解析整个分类?`
        );
        instance.question(text.join("\n") + ": ", async answer => {
            let value = parseInt(answer);
            // log(answer)
            let index = value - 1;
            instance.close();
            if (value <= childCategory.length && value >= 1) {
                let link = childCategory[index].link;
                let result = await this.requestPage(COMMON_CONFIG.baseUrl + link);
                let endPage = ~~this.getEndPage(result);
                if (endPage < 1) {
                    console.log("该子分类无数据，请选择其他子分类\n");
                    this.selectChildCategory(parentIndex, parentCategory);
                    return;
                }
                childCategory[index].endPage = endPage;
                this.updateCategoryList();
                // console.log(endPage)
                // log("解析" + childCategory[index].title)
                new ParseTableList(parentIndex, false, link, categoryList);
            } else {
                new ParseTableList(
                    parentIndex,
                    false,
                    parentCategory.link,
                    categoryList
                );
            }
        });
    }
}
