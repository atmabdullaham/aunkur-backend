const axios = require('axios');
const { v4 : uuidv4 } =require('uuid') ;
const globals = require('node-global-storage')
class paymentController {
    bkash_headers = async()=>{
        return {
            'Content-Type': 'application/json',
        'Accept': 'application/json',
        authorization: globals.getValue('id_token'),
        'x-app-key': process.env.BKASH_APP_KEY
        }
    }

    payment_create = async (req, res)=>{
        
        const {amount} = req.body;
        try {
            const {data} = await axios.post(process.env.BKASH_CREATE_PAYMENT_URL,{
    mode: '0011',
    payerReference: ' ',
    callbackURL: 'http://localhost:5000/api/bkash/payment/callback',
    amount: amount,
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: 'inv'+ uuidv4().substring(0,8),

            },{
           headers: await this.bkash_headers()
            })
            console.log(data)
            return res.status(200).json({bkashURL: data.bkashURL})
        } catch (error) {
            return res.status(401).json({error: error.message})
        }
    }
    call_back = async (req, res)=>{
        const { paymentID, status } = req.query

        if (status === 'cancel' || status === 'failure') {
            return res.redirect(`http://localhost:5173/error?message=${status}`)
        }
        if (status === 'success') {
            try {
                const { data } = await axios.post(process.env.BKASH_EXECUTE_PAYMENT_URL, { paymentID }, {
                    headers: await this.bkash_headers()
                })
                if (data && data.statusCode === '0000') {
                    //const userId = globals.get('userId')
                    // await paymentModel.create({
                    //     userId: Math.random() * 10 + 1 ,
                    //     paymentID,
                    //     trxID: data.trxID,
                    //     date: data.paymentExecuteTime,
                    //     amount: parseInt(data.amount)
                    // })
                    console.log(data)

                    return res.redirect(`http://localhost:5173/success`)
                }else{
                    return res.redirect(`http://localhost:5173/error?message=${data.statusMessage}`)
                }
            } catch (error) {
                console.log(error)
                return res.redirect(`http://localhost:5173/error?message=${error.message}`)
            }
    }
}
}

module.exports = new paymentController()